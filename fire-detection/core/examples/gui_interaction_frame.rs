//! Stream raw RGB frames through source-template GUI recognition.
//! gui_interaction_frame PACK_DIR WIDTH HEIGHT < frames.rgb > results.jsonl
use fire_core::gui_interaction::{self, Options};
use std::io::{Read, Write};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.len() != 4 {
        return Err("usage: gui_interaction_frame PACK_DIR WIDTH HEIGHT < RGB24".into());
    }
    let width: usize = args[2].parse()?;
    let height: usize = args[3].parse()?;
    let templates = gui_interaction::load_templates(std::path::Path::new(&args[1]))?;
    let size = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(3))
        .ok_or("overflow")?;
    let mut buffer = vec![0; size];
    let mut input = std::io::stdin().lock();
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    let mut index = 0;
    loop {
        let mut read = 0;
        while read < size {
            let n = input.read(&mut buffer[read..])?;
            if n == 0 {
                break;
            }
            read += n;
        }
        if read == 0 {
            break;
        }
        if read != size {
            return Err("incomplete RGB frame".into());
        }
        let start = std::time::Instant::now();
        let result =
            gui_interaction::detect(&buffer, width, height, &templates, Options::default())?;
        write!(
            output,
            "{{\"index\":{index},\"ms\":{:.3},\"reason\":\"{}\",\"type\":",
            start.elapsed().as_secs_f64() * 1000.,
            result.reason
        )?;
        if let Some(p) = result.matched {
            write!(output,"\"{}\",\"score\":{:.4},\"bounds\":[{:.2},{:.2},{:.2},{:.2}],\"scale\":[{:.3},{:.3}]",p.screen_type,p.score,p.bounds.x,p.bounds.y,p.bounds.width,p.bounds.height,p.scale_x,p.scale_y)?;
        } else {
            write!(output, "null")?;
        }
        write!(output, ",\"alternatives\":[")?;
        for (i, p) in result.alternatives.iter().enumerate() {
            if i > 0 {
                write!(output, ",")?;
            }
            write!(
                output,
                "{{\"type\":\"{}\",\"variant\":\"{}\",\"score\":{:.4}}}",
                p.screen_type, p.variant, p.score
            )?;
        }
        writeln!(output, "]}}")?;
        output.flush()?;
        index += 1;
    }
    Ok(())
}
