package org.firecracking.firelabel.core;

import java.lang.management.ManagementFactory;
import java.util.Random;

/** Repeatable CPU-only kernel benchmark; does not claim game FPS or raycast performance. */
public final class VisibilityPerformance {
    private static volatile long sink;
    public static void main(String[] args){
        Random random=new Random(20261017);Quad[] quads=new Quad[512];
        for(int i=0;i<quads.length;i++){
            double x=random.nextDouble()*40-20,y=random.nextDouble()*14-7,z=-.2-random.nextDouble()*50;
            quads[i]=new Quad(new double[][]{{x,y,z},{x+1,y,z},{x+1,y+1.4,z},{x,y+1.4,z}},new double[][]{{0,1},{1,1},{1,0},{0,0}});
        }
        Projector projector=new Projector(new double[]{1,0,0,0, 0,1.7777777777777777,0,0, 0,0,-1,-1, 0,0,-.1,0},1920,1080);
        ScreenMask gui=(x,y)->x>750&&x<1100&&y>850?1:.15;
        TexelMask mask=(x,y)->(x*7+y*11)%5!=0;Occluder occluder=(cam,p)->p[0]>2&&p[1]<1;
        for(int i=0;i<3;i++)run(quads,projector,gui,mask,occluder,4096);
        com.sun.management.ThreadMXBean bean=(com.sun.management.ThreadMXBean)ManagementFactory.getThreadMXBean();
        long[] times=new long[5],allocated=new long[5];long checksum=0;
        for(int i=0;i<5;i++){
            long before=bean.getThreadAllocatedBytes(Thread.currentThread().getId()),start=System.nanoTime();
            checksum=run(quads,projector,gui,mask,occluder,8192);
            times[i]=System.nanoTime()-start;allocated[i]=bean.getThreadAllocatedBytes(Thread.currentThread().getId())-before;
        }
        java.util.Arrays.sort(times);java.util.Arrays.sort(allocated);
        System.out.printf(java.util.Locale.ROOT,"checksum=%d median_ms=%.3f allocated_mb=%.3f quads=8192%n",checksum,times[2]/1e6,allocated[2]/1048576.0);
    }
    private static long run(Quad[] quads,Projector p,ScreenMask gui,TexelMask mask,Occluder o,int count){
        long hash=1;
        for(int i=0;i<count;i++){
            QuadVisibility.Result r=QuadVisibility.evaluate(quads[i%quads.length],new double[]{0,0,0},p,16,mask,o,4,false,gui);
            hash=hash*31+r.visibleTexels;hash=hash*31+r.opaqueTexels;
            hash=hash*31+Double.doubleToLongBits(r.veilSum);
            if(!r.box.isEmpty()){hash=hash*31+Double.doubleToLongBits(r.box.x0());hash=hash*31+Double.doubleToLongBits(r.box.y0());hash=hash*31+Double.doubleToLongBits(r.box.x1());hash=hash*31+Double.doubleToLongBits(r.box.y1());}
        }
        sink=hash;return hash;
    }
}
