//! Small saturated-orange evidence veto; never emits a fire label.
use std::io::{self,Read,Write};

fn components(rgb:&[u8],world:&[u8],w:usize,h:usize)->Vec<(usize,usize,usize,usize,usize)>{
 let mut m=vec![false;w*h];
 for i in 12*w..w*h{
  let (r,g,b)=(rgb[3*i] as u32,rgb[3*i+1] as u32,rgb[3*i+2] as u32);
  m[i]=world[i]!=0&&r>=96&&g*100>=r*30&&g*100<=r*85&&b*4<=r&&r>=b+80;
 }
 let mut out=Vec::new();let mut q=Vec::new();
 for s in 0..m.len(){
  if !m[s]{continue}m[s]=false;q.clear();q.push(s);let mut k=0;let(mut x0,mut y0,mut x1,mut y1)=(w,h,0,0);
  while k<q.len(){let p=q[k];k+=1;let(x,y)=(p%w,p/w);x0=x0.min(x);x1=x1.max(x);y0=y0.min(y);y1=y1.max(y);
   for yy in y.saturating_sub(1)..=(y+1).min(h-1){for xx in x.saturating_sub(1)..=(x+1).min(w-1){let p=yy*w+xx;if m[p]{m[p]=false;q.push(p)}}}
  }
  out.push((q.len(),x0,y0,x1+1,y1+1));
 }
 out.sort_unstable_by_key(|c|std::cmp::Reverse(c.0));out
}
fn main(){
 let a:Vec<String>=std::env::args().collect();let w:usize=a[1].parse().unwrap();let h:usize=a[2].parse().unwrap();
 let mut input=io::stdin().lock();let mut output=io::BufWriter::new(io::stdout().lock());let mut rgb=vec![0;w*h*3];let mut world=vec![0;w*h];
 loop{if input.read(&mut rgb[..1]).unwrap()==0{break}input.read_exact(&mut rgb[1..]).unwrap();input.read_exact(&mut world).unwrap();
  let c=components(&rgb,&world,w,h);let qualifying:Vec<_>=c.iter().filter(|c|c.0>=128&&c.3-c.1>=24&&c.4-c.2>=8).collect();
  let boxes=qualifying.iter().map(|c|format!("[{}, {}, {}, {}, {}]",c.0,c.1,c.2,c.3,c.4)).collect::<Vec<_>>().join(",");
  writeln!(output,"{{\"retain\":{},\"largest\":{},\"regions\":[{}]}}",!qualifying.is_empty(),c.first().map_or(0,|c|c.0),boxes).unwrap();output.flush().unwrap();
 }
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn excludes_white_brown_and_gui(){let mut rgb=vec![0;32*32*3];let mut world=vec![1;32*32];for i in 0..32*32{rgb[3*i..3*i+3].copy_from_slice(&[220,120,20])}assert_eq!(components(&rgb,&world,32,32)[0].0,640);world.fill(0);assert!(components(&rgb,&world,32,32).is_empty());world.fill(1);for colour in [[255,255,255],[110,65,40]]{for i in 0..32*32{rgb[3*i..3*i+3].copy_from_slice(&colour)}assert!(components(&rgb,&world,32,32).is_empty())}}
}
