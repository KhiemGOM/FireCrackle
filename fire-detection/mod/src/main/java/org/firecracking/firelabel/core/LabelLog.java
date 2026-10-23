package org.firecracking.firelabel.core;

import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.Flushable;
import java.io.IOException;
import java.io.Writer;
import java.util.Collections;
import java.util.Locale;

/** JSONL label log: one line per rendered frame. Schema: see mod/PLAN.md ("Schema v3"). */
public final class LabelLog implements Closeable, Flushable {
    private final BufferedWriter out;
    private boolean closed;

    public LabelLog(Writer out) {
        this.out = new BufferedWriter(out);
    }

    /** A frame with no visible fire. {@code f0}/{@code f1}: displayed row of fire_0 / fire_1, -1 if unavailable. */
    public static String format(int frameId, long tick, int f0, int f1, int width, int height) {
        return format(new FrameRecord(frameId, tick, f0, f1, width, height, Collections.<FireSourceLabel>emptyList()));
    }

    public static String format(FrameRecord r) {
        StringBuilder sb = new StringBuilder(160);
        sb.append("{\"f\":").append(r.frameId)
                .append(",\"tick\":").append(r.tick)
                .append(",\"f0\":").append(r.f0)
                .append(",\"f1\":").append(r.f1)
                .append(",\"w\":").append(r.width)
                .append(",\"h\":").append(r.height)
                .append(",\"fire\":").append(r.fire())
                .append(",\"fires\":[");
        appendSources(sb, r.fires());
        sb.append(']');
        if (r.hasSoulCapture) {
            sb.append(",\"s0\":").append(r.s0).append(",\"s1\":").append(r.s1)
                    .append(",\"soul\":").append(!r.soulFires().isEmpty()).append(",\"soul_fires\":[");
            appendSources(sb, r.soulFires());
            sb.append(']');
        }
        if (r.camera != null) {
            sb.append(',');
            r.camera.appendJson(sb);
        }
        return sb.append('}').toString();
    }

    private static void appendSources(StringBuilder sb, java.util.List<FireSourceLabel> sources) {
        boolean first = true;
        for (FireSourceLabel s : sources) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            switch (s.source) {
                case BLOCK:
                    sb.append("{\"src\":\"block\",\"pos\":[").append(s.x).append(',').append(s.y).append(',')
                            .append(s.z).append(']');
                    break;
                case ENTITY:
                    sb.append("{\"src\":\"entity\",\"id\":").append(s.entityId).append(",\"type\":");
                    appendString(sb, s.entityType);
                    break;
                default:
                    sb.append("{\"src\":\"overlay\"");
                    break;
            }
            sb.append(",\"box\":");
            appendBox(sb, s.box());
            sb.append(",\"vis\":").append(String.format(Locale.ROOT, "%.3f", s.vis()))
                    .append(",\"veil\":").append(String.format(Locale.ROOT, "%.3f", s.veil()))
                    .append(",\"dist\":").append(String.format(Locale.ROOT, "%.2f", s.dist))
                    .append(",\"parts\":[");
            boolean firstPart = true;
            for (FirePart p : s.parts()) {
                if (!firstPart) {
                    sb.append(',');
                }
                firstPart = false;
                sb.append("{\"sheet\":").append(p.sheet)
                        .append(",\"mirror\":").append(p.mirrored)
                        .append(",\"row\":").append(p.row)
                        .append(",\"box\":");
                appendBox(sb, p.box());
                sb.append(",\"vis\":").append(String.format(Locale.ROOT, "%.3f", p.vis()))
                        .append(",\"veil\":").append(String.format(Locale.ROOT, "%.3f", p.veil)).append('}');
            }
            sb.append(']');
            if (!s.quads().isEmpty()) {
                sb.append(",\"quads\":[");
                boolean firstQuad = true;
                for (FireQuadLabel q : s.quads()) {
                    if (!firstQuad) {
                        sb.append(',');
                    }
                    firstQuad = false;
                    appendQuad(sb, q);
                }
                sb.append(']');
            }
            sb.append('}');
        }
    }

    private static void appendQuad(StringBuilder sb, FireQuadLabel q) {
        sb.append("{\"s\":").append(q.sheet)
                .append(",\"m\":").append(q.mirrored ? 1 : 0)
                .append(",\"row\":").append(q.row)
                .append(",\"c\":");
        if (q.hasCorners()) {
            sb.append('[');
            for (int i = 0; i < 4; i++) {
                double[] c = q.corner(i);
                sb.append(i == 0 ? "" : ",").append(String.format(Locale.ROOT, "%.1f,%.1f", c[0], c[1]));
            }
            sb.append(']');
        } else {
            sb.append("null");
        }
        sb.append(",\"uv\":[");
        for (int i = 0; i < 4; i++) {
            double[] t = q.uv(i);
            sb.append(i == 0 ? "" : ",").append(String.format(Locale.ROOT, "%.3f,%.3f", t[0], t[1]));
        }
        sb.append("],\"vis\":").append(String.format(Locale.ROOT, "%.3f", q.vis()))
                .append(",\"veil\":").append(String.format(Locale.ROOT, "%.3f", q.veil)).append('}');
    }

    private static void appendString(StringBuilder sb, String text) {
        sb.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    private static void appendBox(StringBuilder sb, BBox box) {
        if (box.isEmpty()) {
            sb.append("null");
            return;
        }
        sb.append(String.format(Locale.ROOT, "[%.1f,%.1f,%.1f,%.1f]", box.x0(), box.y0(), box.x1(), box.y1()));
    }

    public void write(int frameId, long tick, int f0, int f1, int width, int height) throws IOException {
        write(new FrameRecord(frameId, tick, f0, f1, width, height, Collections.<FireSourceLabel>emptyList()));
    }

    public void write(FrameRecord record) throws IOException {
        if (closed) {
            throw new IllegalStateException("label log is closed");
        }
        out.write(format(record));
        out.write('\n');
    }

    @Override
    public void flush() throws IOException {
        if (!closed) {
            out.flush();
        }
    }

    @Override
    public void close() throws IOException {
        if (closed) {
            return;
        }
        closed = true;
        out.close();
    }
}
