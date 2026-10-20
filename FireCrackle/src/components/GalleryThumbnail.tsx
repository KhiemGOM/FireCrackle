import {useEffect,useRef,useState} from 'react';
import {photoPreview} from '../lib/imagePreview';
import type {GalleryImage} from '../lib/imageGallery';

export function GalleryThumbnail({image}:{image:GalleryImage}){
  const element=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[url,setUrl]=useState<string>();
  useEffect(()=>{
    if(!element.current)return;
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'120px'});
    observer.observe(element.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{let cancelled=false;if(visible)void photoPreview(image.file).then(url=>{if(!cancelled)setUrl(url);}).catch(()=>{if(!cancelled)setUrl(image.url);});return()=>{cancelled=true;};},[image.file,image.url,visible]);
  return <span ref={element} style={{display:'block',width:138,height:88,flexShrink:0}}>{url?<img src={url} alt="" decoding="async" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span aria-hidden="true">…</span>}</span>;
}
