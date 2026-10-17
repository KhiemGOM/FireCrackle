//! A limit on how many ffmpeg frame decodes run at the same time, for the whole process.
//!
//! Every request for a frame that is not in memory starts a decode of its own (a second or two of one-core-plus work at
//! 1080p). After a seek the app could ask for the sought frame and its neighbours together, and each started a decode
//! of about 120 frames: four at once where there had been one. On a busy laptop that is how a timeline skip took the
//! whole machine down. The gate makes the extra requests wait for a free slot (and give up when they are cancelled)
//! instead, so a burst of requests becomes a short queue and not a burst of processes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// How often a waiting caller looks at its cancel flag.
const POLL: Duration = Duration::from_millis(50);

/// A request that has waited this long is served next whatever came after it.
const STARVATION: Duration = Duration::from_secs(5);

/// Decodes at once until the settings say otherwise (`decode.max_parallel`).
pub const DEFAULT_LIMIT: usize = 2;

struct State {
    limit: usize,
    in_flight: usize,
    next_ticket: u64,
    /// The callers waiting for a slot, oldest first.
    waiting: Vec<(u64, Instant)>,
}

pub struct DecodeGate {
    state: Mutex<State>,
    freed: Condvar,
    starvation: Duration,
}

/// Holds one slot; the slot comes back when this is dropped, even when the holder panics.
pub struct Permit<'a> {
    gate: &'a DecodeGate,
}

impl DecodeGate {
    pub fn new(limit: usize) -> DecodeGate {
        DecodeGate::with_starvation(limit, STARVATION)
    }

    /// `new`, with the time after which a waiting request is served before newer ones.
    pub fn with_starvation(limit: usize, starvation: Duration) -> DecodeGate {
        DecodeGate {
            state: Mutex::new(State {
                limit: limit.max(1),
                in_flight: 0,
                next_ticket: 0,
                waiting: Vec::new(),
            }),
            freed: Condvar::new(),
            starvation,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // a panicking decode must not jam the gate for good
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn limit(&self) -> usize {
        self.lock().limit
    }

    /// Change the limit. Decodes already running are left alone; waiting callers are let in if there is room now.
    pub fn set_limit(&self, limit: usize) {
        self.lock().limit = limit.max(1);
        self.freed.notify_all();
    }

    pub fn in_flight(&self) -> usize {
        self.lock().in_flight
    }

    /// How many callers are waiting for a slot.
    pub fn waiting(&self) -> usize {
        self.lock().waiting.len()
    }

    /// Wait for a free slot. `None` when `cancel` is set (before or while waiting): a cancelled caller takes no slot.
    ///
    /// When a slot frees up, the newest waiting request gets it: after a burst of seeks the place the user landed on
    /// is decoded first, not after the places they passed. A request that has waited longer than the starvation time
    /// goes first instead, so an old request cannot be put off for ever by a stream of new ones.
    pub fn acquire(&self, cancel: &AtomicBool) -> Option<Permit<'_>> {
        let mut state = self.lock();
        let ticket = state.next_ticket;
        state.next_ticket += 1;
        state.waiting.push((ticket, Instant::now()));
        loop {
            if cancel.load(Ordering::SeqCst) {
                state.waiting.retain(|w| w.0 != ticket);
                drop(state);
                self.freed.notify_all(); // the next in line may be waiting behind this one
                return None;
            }
            if state.in_flight < state.limit && Self::is_next(&state, ticket, self.starvation) {
                state.waiting.retain(|w| w.0 != ticket);
                state.in_flight += 1;
                return Some(Permit { gate: self });
            }
            state = self
                .freed
                .wait_timeout(state, POLL)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    fn is_next(state: &State, ticket: u64, starvation: Duration) -> bool {
        match (state.waiting.first(), state.waiting.last()) {
            (Some(oldest), Some(newest)) => {
                if oldest.1.elapsed() > starvation {
                    oldest.0 == ticket
                } else {
                    newest.0 == ticket
                }
            }
            _ => false,
        }
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        let mut state = self.gate.lock();
        state.in_flight = state.in_flight.saturating_sub(1);
        drop(state);
        self.gate.freed.notify_all(); // only the one whose turn it is takes the slot
    }
}

/// The gate every frame decode in this process goes through.
pub fn decode_gate() -> &'static DecodeGate {
    static GATE: OnceLock<DecodeGate> = OnceLock::new();
    GATE.get_or_init(|| DecodeGate::new(DEFAULT_LIMIT))
}
