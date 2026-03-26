import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  saveStravaToken,
  getPendingUpload,
  clearPendingUpload,
  uploadToStrava,
} from '../utils/stravaService';

/**
 * Handles the redirect back from Strava OAuth.
 * Reads token params from URL, saves them, then uploads any pending workout.
 */
export default function StravaCallback() {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'processing', message: '' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken  = params.get('strava_access_token');
    const refreshToken = params.get('strava_refresh_token');
    const expiresAt    = parseInt(params.get('strava_expires_at') || '0', 10);
    const athleteName  = params.get('strava_athlete') || '';
    const error        = params.get('strava_error');

    if (error || !accessToken) {
      const msg = error === 'cancelled'
        ? 'Strava login was cancelled.'
        : 'Could not connect to Strava. Try again.';
      setState({ status: 'error', message: msg });
      return;
    }

    saveStravaToken({ accessToken, refreshToken, expiresAt, athleteName });

    const pending = getPendingUpload();
    if (!pending) {
      setState({ status: 'done', message: `Connected to Strava${athleteName ? ` as ${athleteName}` : ''}.` });
      setTimeout(() => navigate('/'), 2000);
      return;
    }

    setState({ status: 'uploading', message: 'Uploading workout to Strava…' });

    uploadToStrava(pending.tcxContent, pending.workoutName)
      .then(() => {
        clearPendingUpload();
        setState({ status: 'done', message: 'Workout uploaded to Strava!' });
        setTimeout(() => navigate('/'), 2500);
      })
      .catch(err => {
        clearPendingUpload();
        setState({ status: 'error', message: `Upload failed: ${err.message}` });
      });
  }, [navigate]);

  const { status, message } = state;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '1rem',
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: 'inherit',
    }}>
      {(status === 'processing' || status === 'uploading') && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏳</div>
          <div style={{ color: '#aaa' }}>{message || 'Connecting to Strava…'}</div>
        </div>
      )}

      {status === 'done' && (
        <div style={{ textAlign: 'center', color: '#00d4ff' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✓</div>
          <div>{message}</div>
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', color: '#ff4444' }}>✗</div>
          <div style={{ color: '#ff4444', marginBottom: '1.5rem' }}>{message}</div>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '0.6rem 1.5rem',
              background: '#1a1a2e',
              border: '1px solid #333',
              color: '#fff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Back to Home
          </button>
        </div>
      )}
    </div>
  );
}
