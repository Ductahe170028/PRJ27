import "./app.css";

export function App() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Đi đến khu vực làm việc
      </a>

      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand__mark" aria-hidden="true">
            M360
          </span>
          <div>
            <p className="app-brand__eyebrow">Tech Support workspace</p>
            <h1>MindX 360</h1>
            <p className="app-brand__description">
              Một góc nhìn thống nhất cho dữ liệu CRM và LMS.
            </p>
          </div>
        </div>

        <div className="app-status" aria-label="Chế độ ứng dụng">
          <span className="app-status__indicator" aria-hidden="true" />
          V1 · Chỉ đọc
        </div>
      </header>

      <main className="workspace" id="workspace">
        <section
          className="workspace-panel workspace-panel--tree"
          aria-labelledby="tree-panel-title"
        >
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Navigation</p>
              <h2 id="tree-panel-title">Cây dữ liệu</h2>
            </div>
            <span className="workspace-panel__badge">Tree</span>
          </div>
          <div className="workspace-placeholder">
            <span className="workspace-placeholder__mark" aria-hidden="true">
              T
            </span>
            <p>Danh sách CRM và LMS sẽ hiển thị tại đây.</p>
          </div>
        </section>

        <section
          className="workspace-panel workspace-panel--detail"
          aria-labelledby="detail-panel-title"
        >
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Workspace</p>
              <h2 id="detail-panel-title">Chi tiết</h2>
            </div>
            <span className="workspace-panel__badge">Detail</span>
          </div>
          <div className="workspace-placeholder">
            <span className="workspace-placeholder__mark" aria-hidden="true">
              D
            </span>
            <p>Thông tin của mục đang chọn sẽ hiển thị tại đây.</p>
          </div>
        </section>

        <section
          className="workspace-panel workspace-panel--related"
          aria-labelledby="related-panel-title"
        >
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Context</p>
              <h2 id="related-panel-title">Liên kết</h2>
            </div>
            <span className="workspace-panel__badge">Related</span>
          </div>
          <div className="workspace-placeholder">
            <span className="workspace-placeholder__mark" aria-hidden="true">
              R
            </span>
            <p>Quan hệ đã xác minh sẽ hiển thị tại đây.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

