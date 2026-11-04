/**
 * 虚拟验证：模块占位页。
 * 后续在此接入 CAE / CFD 等仿真结果，并与试验报告、试验数据做一致性比对。
 */
export function VirtualValidationPage() {
  return (
    <div className="settings-card">
      <h3>虚拟验证</h3>
      <p className="empty-hint">
        虚拟验证模块正在规划中：建成后将在此接入 CAE / CFD 等仿真结果，并与「试验报告」中的试验数据做一致性比对。
      </p>
    </div>
  );
}
