package org.firecracking.firelabel.core;

import java.util.*;

/** Exact broad-phase for the legacy hitbox approximation. Leaves retain the original RayBox test. */
public final class EntityOcclusionIndex {
    public static final class Entry {
        final int id;final double[] min,max;
        public Entry(int id,double[] min,double[] max){this.id=id;this.min=min.clone();this.max=max.clone();}
    }
    private static final class Node {
        final double[] min={Double.POSITIVE_INFINITY,Double.POSITIVE_INFINITY,Double.POSITIVE_INFINITY};
        final double[] max={Double.NEGATIVE_INFINITY,Double.NEGATIVE_INFINITY,Double.NEGATIVE_INFINITY};
        int from,to;Node left,right;
    }
    private final Entry[] entries;private final Node root;
    public EntityOcclusionIndex(List<Entry> source){entries=source.toArray(new Entry[0]);root=entries.length==0?null:build(0,entries.length);}
    private Node build(int from,int to){
        Node n=new Node();n.from=from;n.to=to;
        for(int i=from;i<to;i++)for(int a=0;a<3;a++){n.min[a]=Math.min(n.min[a],entries[i].min[a]);n.max[a]=Math.max(n.max[a],entries[i].max[a]);}
        if(to-from>8){
            int axis=0;for(int a=1;a<3;a++)if(n.max[a]-n.min[a]>n.max[axis]-n.min[axis])axis=a;
            final int splitAxis=axis;Arrays.sort(entries,from,to,Comparator.comparingDouble(e->e.min[splitAxis]+e.max[splitAxis]));
            int middle=(from+to)/2;n.left=build(from,middle);n.right=build(middle,to);
        }
        return n;
    }
    public boolean blocked(double[] camera,double[] target,int excludeId){return blocked(root,camera,target,excludeId);}
    private boolean blocked(Node n,double[] camera,double[] target,int excludeId){
        if(n==null)return false;
        double broad=RayBox.entryFraction(camera,target,n.min,n.max);
        if(broad<0||broad>=1.0-1e-6)return false;
        if(n.left!=null)return blocked(n.left,camera,target,excludeId)||blocked(n.right,camera,target,excludeId);
        for(int i=n.from;i<n.to;i++){
            Entry e=entries[i];if(e.id==excludeId)continue;
            if(camera[0]>=e.min[0]&&camera[0]<=e.max[0]&&camera[1]>=e.min[1]&&camera[1]<=e.max[1]&&camera[2]>=e.min[2]&&camera[2]<=e.max[2])continue;
            double t=RayBox.entryFraction(camera,target,e.min,e.max);
            if(t>=0&&t<1.0-1e-6)return true;
        }
        return false;
    }
}
