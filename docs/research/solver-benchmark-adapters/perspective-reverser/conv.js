// Camera mapping between the benchmark and PerspectiveReverser's state.
// The tool's state is already Minecraft's convention (read from project(), main.js 14-58): eye position (its /tp
// button subtracts 1.62 to get the feet), yaw 0 looks +z and 90 looks -x, positive pitch looks down, cameraFov is the
// vertical FOV in degrees (f = 1/tan(fov/2) scaled by screenHeight/2, screenHeight = image height). No roll.
function benchToState(cam, state) {
    state.cameraX = cam.x; state.cameraY = cam.y; state.cameraZ = cam.z;
    state.cameraYaw = cam.yaw; state.cameraPitch = cam.pitch; state.cameraFov = cam.fov;
}

// Returns the bench camera, or null when the tool's answer has no equivalent in the benchmark's convention
// (|pitch| > 90 or FOV outside (0, 180): the tool's free parameters can wander there, which is a 180-degree roll
// or a mirrored image, neither of which the bench camera can express).
function stateToBench(state) {
    const yaw = ((state.cameraYaw % 360) + 540) % 360 - 180;
    const cam = { x: state.cameraX, y: state.cameraY, z: state.cameraZ, yaw, pitch: state.cameraPitch, roll: 0, fov: state.cameraFov };
    if (![cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.fov].every(Number.isFinite)) return null;
    if (Math.abs(cam.pitch) > 90 || !(cam.fov > 0 && cam.fov < 180)) return null;
    return cam;
}

module.exports = { benchToState, stateToBench };
