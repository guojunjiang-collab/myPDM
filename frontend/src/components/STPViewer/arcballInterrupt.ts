/**
 * 中断 ArcballControls 的惯性旋转动画（ANIMATION_ROTATE）。
 *
 * 背景：ArcballControls 在拖拽释放后若角速度足够，会启动独立的 rAF 循环
 * （onRotationAnim），每帧以"拖拽起点时的 _cameraMatrixState"为基准重建相机姿态。
 * 视图跳转动画（CameraController）期间若不中断它，两者会在同一帧内互相覆盖相机姿态：
 * 惯性循环（注册更晚、帧内后执行）把相机拉回"拖拽起点姿态 + 残余衰减旋转"，
 * 导致法向视图落点偏离标准视图（模型对不齐），且 ViewCube 同步发生在惯性写入之前，
 * 姿态球与模型观感不同步。
 *
 * 中断方式与 ArcballControls 自身启动新操作（onPointerDown 的 ROTATE/FOV 分支）一致：
 * 取消 pending 的 rAF id 并复位内部书签。惯性循环的唯一调度点就是这条 rAF 链，
 * 取消后不再调度下一帧，自然停止（残留回调触发时因 _state 非 ANIMATION_ROTATE
 * 也会走中断分支，不再应用旋转）。
 */
export function interruptArcballInertia(controls: any): void {
  if (!controls) return;
  if (typeof controls._animationId === 'number' && controls._animationId !== -1) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      try {
        window.cancelAnimationFrame(controls._animationId);
      } catch {
        /* 忽略个别环境（如测试）的取消失败 */
      }
    }
  }
  controls._animationId = -1;
  controls._timeStart = -1;
}
