import { NavLink } from 'react-router';

export function AppNav() {
  return (
    <header className="app-header">
      <div className="app-brand">Notification Platform</div>
      <nav className="app-nav">
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/send">Send</NavLink>
        <NavLink to="/notifications">Notifications</NavLink>
      </nav>
    </header>
  );
}
