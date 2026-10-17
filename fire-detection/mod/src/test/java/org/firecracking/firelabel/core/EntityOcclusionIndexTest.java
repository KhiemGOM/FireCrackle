package org.firecracking.firelabel.core;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class EntityOcclusionIndexTest {
    private static boolean linear(List<EntityOcclusionIndex.Entry> entries,double[] cam,double[] target,int exclude){
        for(EntityOcclusionIndex.Entry e:entries){
            if(e.id==exclude)continue;
            if(cam[0]>=e.min[0]&&cam[0]<=e.max[0]&&cam[1]>=e.min[1]&&cam[1]<=e.max[1]&&cam[2]>=e.min[2]&&cam[2]<=e.max[2])continue;
            double t=RayBox.entryFraction(cam,target,e.min,e.max);if(t>=0&&t<1.0-1e-6)return true;
        }
        return false;
    }
    @Test void matchesOriginalLoopAcrossRandomScenes(){
        Random r=new Random(19);List<EntityOcclusionIndex.Entry> entries=boxes(r,256);EntityOcclusionIndex index=new EntityOcclusionIndex(entries);
        for(int i=0;i<10000;i++){
            double[] cam={r.nextDouble()*20-10,r.nextDouble()*20-10,r.nextDouble()*20-10};
            double[] target={r.nextDouble()*100-50,r.nextDouble()*100-50,r.nextDouble()*100-50};int exclude=i%257-1;
            assertEquals(linear(entries,cam,target,exclude),index.blocked(cam,target,exclude),"query "+i);
        }
    }
    @Test void preservesCameraInsideAndEndpointRules(){
        List<EntityOcclusionIndex.Entry> e=Arrays.asList(new EntityOcclusionIndex.Entry(3,new double[]{-1,-1,-1},new double[]{1,1,1}),new EntityOcclusionIndex.Entry(4,new double[]{5,-1,-1},new double[]{6,1,1}));
        EntityOcclusionIndex index=new EntityOcclusionIndex(e);double[] cam={0,0,0};
        assertFalse(index.blocked(cam,new double[]{5,0,0},-1));assertTrue(index.blocked(cam,new double[]{7,0,0},-1));assertFalse(index.blocked(cam,new double[]{7,0,0},4));
        assertFalse(new EntityOcclusionIndex(Collections.emptyList()).blocked(cam,new double[]{7,0,0},-1));
    }
    private static List<EntityOcclusionIndex.Entry> boxes(Random r,int count){
        List<EntityOcclusionIndex.Entry> out=new ArrayList<EntityOcclusionIndex.Entry>();
        for(int i=0;i<count;i++){
            double x=r.nextDouble()*100-50,y=r.nextDouble()*100-50,z=r.nextDouble()*100-50;
            out.add(new EntityOcclusionIndex.Entry(i,new double[]{x,y,z},new double[]{x+.6,y+1.8,z+.6}));
        }
        return out;
    }
    public static void main(String[] args){
        Random r=new Random(14);List<EntityOcclusionIndex.Entry> entries=boxes(r,1500);long buildStart=System.nanoTime();EntityOcclusionIndex index=new EntityOcclusionIndex(entries);double buildMs=(System.nanoTime()-buildStart)/1e6;
        double[][] targets=new double[20000][3];for(double[] t:targets)for(int a=0;a<3;a++)t[a]=r.nextDouble()*120-60;
        double[] cam={0,0,0};int oldCount=0,newCount=0;long start=System.nanoTime();
        for(double[] t:targets)if(linear(entries,cam,t,-1))oldCount++;double linearMs=(System.nanoTime()-start)/1e6;start=System.nanoTime();
        for(double[] t:targets)if(index.blocked(cam,t,-1))newCount++;double indexedMs=(System.nanoTime()-start)/1e6;
        if(oldCount!=newCount)throw new AssertionError("benchmark parity");
        System.out.printf(Locale.ROOT,"entities=1500 rays=20000 hits=%d linear_ms=%.3f indexed_ms=%.3f build_ms=%.3f%n",oldCount,linearMs,indexedMs,buildMs);
    }
}
