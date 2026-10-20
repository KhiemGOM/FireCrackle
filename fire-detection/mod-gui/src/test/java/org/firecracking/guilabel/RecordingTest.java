package org.firecracking.guilabel;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class RecordingTest {
    @TempDir Path temp;

    @Test void stripRoundTripsAndEveryPairHasOppositePolarity() {
        for (long id : new long[]{0, 1, 42, 65535, 0xdeadbeefL, 0xffffffffL}) {
            long decoded = 0;
            for (int bit = 0; bit < 64; bit++) {
                assertNotEquals(FrameStrip.white(id, 2*bit), FrameStrip.white(id, 2*bit+1));
                if (bit >= 16 && bit < 48) decoded = (decoded << 1) | (FrameStrip.white(id, 2*bit) ? 1 : 0);
            }
            assertEquals(id, decoded);
        }
        assertNotEquals(FrameStrip.crc(42), FrameStrip.crc(43));
    }

    @Test void asynchronousCloseDrainsRecordsAndReportsCompleteness() throws Exception {
        Path path = temp.resolve("frames.jsonl");
        AsyncJsonLog log = new AsyncJsonLog(path, 128);
        for (int id = 0; id < 100; id++) {
            JsonObject row = new JsonObject(); row.addProperty("frame", id);
            assertTrue(log.offer(row));
        }
        log.close();
        var rows = Files.readAllLines(path);
        assertEquals(101, rows.size());
        for (int id = 0; id < 100; id++) assertEquals(id, JsonParser.parseString(rows.get(id)).getAsJsonObject().get("frame").getAsInt());
        assertTrue(JsonParser.parseString(rows.getLast()).getAsJsonObject().get("complete").getAsBoolean());
        assertFalse(log.offer(new JsonObject()));
    }

    @Test void runtimeRegistryHasUniqueKnownTypesAndCoversNewContainers() throws Exception {
        try (var stream = getClass().getResourceAsStream("/guilabel-screen-types.json")) {
            assertNotNull(stream);
            var rows = JsonParser.parseString(new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray();
            var ids = new java.util.HashSet<String>();
            var classes = new java.util.HashSet<String>();
            for (var row : rows) {
                assertTrue(ids.add(row.getAsJsonObject().get("id").getAsString()));
                assertTrue(classes.add(row.getAsJsonObject().get("intermediary").getAsString()));
            }
            assertEquals(138, ids.size());
            assertTrue(ids.contains("inventory.crafter_screen"));
            assertTrue(ids.contains("inventory.nautilus_inventory_screen"));
        }
    }
}
