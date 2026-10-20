package org.firecracking.guilabel;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded, nonblocking render-thread producer. A missing record is never silently valid. */
public final class AsyncJsonLog implements AutoCloseable {
    private final ArrayBlockingQueue<JsonObject> queue;
    private final AtomicLong dropped = new AtomicLong();
    private final Thread worker;
    private volatile boolean accepting = true;
    private volatile Throwable failure;

    public AsyncJsonLog(Path file, int capacity) throws IOException {
        Files.createDirectories(file.getParent());
        BufferedWriter output = Files.newBufferedWriter(file, StandardCharsets.UTF_8);
        queue = new ArrayBlockingQueue<>(capacity);
        worker = new Thread(() -> write(output), "GUI-label-writer");
        worker.setDaemon(true);
        worker.start();
    }

    public boolean offer(JsonObject row) {
        if (!accepting || failure != null || !queue.offer(row)) {
            dropped.incrementAndGet();
            return false;
        }
        return true;
    }

    public boolean healthy() { return failure == null && dropped.get() == 0; }
    public long dropped() { return dropped.get(); }

    private void write(BufferedWriter output) {
        Gson gson = new Gson();
        long lastFlush = System.nanoTime();
        try (output) {
            while (accepting || !queue.isEmpty()) {
                JsonObject row = queue.poll(100, TimeUnit.MILLISECONDS);
                if (row != null) {
                    output.write(gson.toJson(row));
                    output.newLine();
                }
                if (System.nanoTime() - lastFlush > 1_000_000_000L) {
                    output.flush();
                    lastFlush = System.nanoTime();
                }
            }
            JsonObject end = new JsonObject();
            end.addProperty("record", "session_end");
            end.addProperty("dropped_records", dropped.get());
            end.addProperty("complete", dropped.get() == 0);
            output.write(gson.toJson(end));
            output.newLine();
        } catch (Throwable error) {
            failure = error;
            System.err.println("GUI label writer FAILED: " + error);
        }
    }

    @Override public synchronized void close() {
        accepting = false;
        try { worker.join(5000); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
    }
}
