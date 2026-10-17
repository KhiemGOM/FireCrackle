//! Broader orange-only deterministic ablation; shared Rust unveil, never white.
#[path = "../../core/src/veil.rs"]
#[allow(dead_code)] mod shared_veil;
use std::io::{self,Read,Write};
fn orange(c:[u8;3],variant:usize)->bool {
 let [r,g,b]=c.map(|v|v as f64);
 match variant {
  0=>r>=64. && g>=0.23*r && g<=0.88*r && b<=0.5*r && r-b>=24.,
  1=>r>=32. && g>=0.23*r && g<=0.88*r && b<=0.5*r && r-b>=20.,
  _=>r>=32. && g>=0.12*r && g<=0.95*r && b<=0.60*r && r-b>=20.
 }
}
fn mask(rgb:&[u8],w:usize,h:usize,variant:usize)->(Vec<u8>,Vec<u8>){
 let mut m=vec![0;w*h]; let mut red=vec![0;w*h];
 for p in 12*w..w*h {m[p]=orange([rgb[p*3],rgb[p*3+1],rgb[p*3+2]],variant) as u8;red[p]=rgb[p*3];} (m,red)
}
fn integral(m: &[u8], w: usize, h: usize) -> Vec<u32> {
    let mut v = vec![0u32; (w + 1) * (h + 1)];
    for y in 0..h {
        let mut row = 0;
        for x in 0..w {
            row += m[y * w + x] as u32;
            v[(y + 1) * (w + 1) + x + 1] = v[y * (w + 1) + x + 1] + row;
        }
    }
    v
}
fn local(v: &[u32], w: usize, h: usize, side: usize) -> u32 {
    let s = side.min(w).min(h);
    let step = (s / 2).max(1);
    let mut best = 0;
    let mut ys: Vec<_> = (0..=h - s).step_by(step).collect();
    ys.push(h - s);
    let mut xs: Vec<_> = (0..=w - s).step_by(step).collect();
    xs.push(w - s);
    for &y in &ys {
        for &x in &xs {
            let stride = w + 1;
            // Signed arithmetic avoids unsigned intermediate subtraction underflow.
            let count = v[(y + s) * stride + x + s] as i64 + v[y * stride + x] as i64
                - v[y * stride + x + s] as i64
                - v[(y + s) * stride + x] as i64;
            best = best.max(count as u32);
        }
    }
    best
}
fn evidence(m: &[u8], red: &[u8], w: usize, h: usize) -> String {
    let count: usize = m.iter().map(|&v| v as usize).sum();
    let mut seen = vec![false; m.len()];
    let mut queue = Vec::new();
    let mut largest = 0;
    for p in 0..m.len() {
        if m[p] == 0 || seen[p] {
            continue;
        }
        queue.clear();
        queue.push(p);
        seen[p] = true;
        let mut i = 0;
        while i < queue.len() {
            let q = queue[i];
            i += 1;
            let (x, y) = (q % w, q / w);
            for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let n = yy * w + xx;
                    if m[n] != 0 && !seen[n] {
                        seen[n] = true;
                        queue.push(n);
                    }
                }
            }
        }
        largest = largest.max(queue.len());
    }
    let mut textured = vec![0u8; m.len()];
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            if m[p] == 0 {
                continue;
            }
            for q in [
                if x + 1 < w { p + 1 } else { p },
                if y + 1 < h { p + w } else { p },
            ] {
                // Only contrast BETWEEN two orange pixels counts; white neighbours do not.
                if m[q] != 0 && red[p].abs_diff(red[q]) >= 24 {
                    textured[p] = 1;
                    textured[q] = 1;
                }
            }
        }
    }
    let sums = integral(m, w, h);
    let tex = integral(&textured, w, h);
    format!("{{\"pixels\":{},\"single\":{},\"local24\":{},\"local48\":{},\"local96\":{},\"texture24\":{},\"texture48\":{},\"texture96\":{}}}",count,largest,
        local(&sums,w,h,24),local(&sums,w,h,48),local(&sums,w,h,96),local(&tex,w,h,24),local(&tex,w,h,48),local(&tex,w,h,96))
}
fn main(){let a:Vec<String>=std::env::args().collect();let w:usize=a[1].parse().unwrap();let h:usize=a[2].parse().unwrap();
 let mut input=io::stdin().lock();let mut output=io::BufWriter::new(io::stdout().lock());let mut rgb=vec![0;w*h*3];
 loop{if input.read(&mut rgb[..1]).unwrap()==0{break;} input.read_exact(&mut rgb[1..]).unwrap();
 let undo=shared_veil::detect_veil(&rgb,w,h,12).unwrap();let fixed=if undo{shared_veil::unveil_rgb(&rgb,w,h).unwrap()}else{rgb.clone()};
 let mut fields=Vec::new();for v in 0..3{let(m,r)=mask(&rgb,w,h,v);let raw=evidence(&m,&r,w,h);let(m,r)=mask(&fixed,w,h,v);let auto=evidence(&m,&r,w,h);fields.push(format!("\"v{}\":{{\"raw\":{},\"auto\":{}}}",v,raw,auto));}
 writeln!(output,"{{{}}}",fields.join(",")).unwrap();output.flush().unwrap();}}
#[cfg(test)] mod tests{use super::*;#[test] fn colour_nesting(){for r in (0..=255).step_by(7){for g in (0..=255).step_by(7){for b in (0..=255).step_by(7){let c=[r,g,b];assert!(!orange(c,0)||orange(c,1));assert!(!orange(c,1)||orange(c,2));}}}}#[test]fn no_white(){for v in 0..3{for n in 0..=255{assert!(!orange([n,n,n],v));}}assert!(!orange([40,8,2],0));assert!(orange([40,8,2],2));}}
