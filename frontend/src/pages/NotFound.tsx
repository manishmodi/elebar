import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="empty-state">
      <h2>404 — Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <p style={{ marginTop: 12 }}>
        <Link to="/" className="link-btn">
          Return to dashboard
        </Link>
      </p>
    </div>
  );
}
