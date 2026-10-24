//! A limit on how many ffmpeg frame decodes run at the same time, for the whole process.
//!
//! Requests once started overlapping multi-frame decodes after seeks. Bound both active
//! processes and queued callers. The reported whole-PC shutdown has no proven cause.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// How often a waiting caller looks at its cancel flag.
const POLL: Duration = Duration::from_millis(50);

/// A request that has waited this long is served next whatever came after it.
const STARVATION: Duration = Duration::from_secs(5);

/// Decodes at once until the settings say otherwise (`decode.max_parallel`).
pub const DEFAULT_LIMIT: usize = 2;

const MAX_WAITING: usize = 32; // callers waiting at most; past it a normal waiter is dropped

/// `Urgent` (the paused full-quality frame the user waits for) goes before every `Normal` decode, never dropped for one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Normal,
    Urgent,
}

struct State {
    limit: usize,
    in_flight: usize,
    next_ticket: u64,
    /// The callers waiting for a slot, oldest first.
    waiting: Vec<(u64, Instant, Priority)>,
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
                limit: limit.clamp(1, 8),
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
        self.lock().limit = limit.clamp(1, 8);
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
        self.acquire_as(cancel, Priority::Normal)
    }

    /// `acquire` at `priority`: the most urgent class first, each by the rules above; a full queue drops a normal waiter.
    pub fn acquire_as(&self, cancel: &AtomicBool, priority: Priority) -> Option<Permit<'_>> {
        let mut state = self.lock();
        let ticket = state.next_ticket;
        state.next_ticket += 1;
        if state.waiting.len() >= MAX_WAITING {
            let normal = state.waiting.iter().position(|w| w.2 == Priority::Normal);
            // everyone waiting is urgent and this is not: no room
            let i = normal.or((priority == Priority::Urgent).then_some(0))?;
            state.waiting.remove(i);
        }
        state.waiting.push((ticket, Instant::now(), priority));
        self.freed.notify_all();
        loop {
            if cancel.load(Ordering::SeqCst) || !state.waiting.iter().any(|w| w.0 == ticket) {
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

    /// Within the most urgent waiting class: the overdue oldest, else the newest.
    fn is_next(state: &State, ticket: u64, starvation: Duration) -> bool {
        let top = state.waiting.iter().map(|w| w.2).max();
        let mut class = state.waiting.iter().filter(|w| Some(w.2) == top);
        let Some(oldest) = class.next() else {
            return false;
        };
        let newest = class.next_back().unwrap_or(oldest);
        let overdue = oldest.1.elapsed() > starvation;
        (if overdue { oldest } else { newest }).0 == ticket
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
