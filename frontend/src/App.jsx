import React, { Component } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

// Catches any unhandled render error in the tree and shows a recovery screen
// instead of a blank page.
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem',
          background: '#0a0a0a', color: '#e0e0e0', fontFamily: 'inherit',
          padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', color: '#ff4444' }}>Something went wrong</div>
          <pre style={{
            background: '#1a1a2e', padding: '1rem', borderRadius: '8px',
            color: '#ff8888', fontSize: '0.8rem', maxWidth: '600px',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); }}
            style={{
              padding: '0.6rem 1.5rem', background: '#1a1a2e',
              border: '1px solid #333', color: '#fff', borderRadius: '6px',
              cursor: 'pointer', fontSize: '0.9rem',
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { AntProvider } from './contexts/AntContext';
import HomePage from './pages/HomePage';
import TrainingProgramPage from './pages/TrainingProgramPage';
import WorkoutPage from './pages/WorkoutPage';
import SettingsPage from './pages/SettingsPage';
import AiWorkoutPage from './pages/AiWorkoutPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import HelpPage from './pages/HelpPage';
import RoutePage from './pages/RoutePage';
import StravaCallback from './pages/StravaCallback';
import Footer from './components/Footer';
import { initUsers } from './services/userManager';

// Run once at module load — before any component renders.
// Creates the initial user record from existing data on first launch.
initUsers();

function AppShell() {
  const location = useLocation();
  // The workout page has its own full-screen layout; skip the footer there.
  const hideFooter = location.pathname.startsWith('/workout/');

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/training" element={<TrainingProgramPage />} />
        <Route path="/workout/:id" element={<WorkoutPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ai-workout" element={<AiWorkoutPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/route" element={<RoutePage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/strava/callback" element={<StravaCallback />} />
      </Routes>
      {!hideFooter && <Footer />}
    </>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <Router>
        <AntProvider>
          <AppShell />
        </AntProvider>
      </Router>
    </AppErrorBoundary>
  );
}

export default App;
