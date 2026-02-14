import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AntProvider } from './contexts/AntContext';
import HomePage from './pages/HomePage';
import TrainingProgramPage from './pages/TrainingProgramPage';
import WorkoutPage from './pages/WorkoutPage';

import SettingsPage from './pages/SettingsPage';
import AiWorkoutPage from './pages/AiWorkoutPage';

function App() {
  return (
    <Router>
      <AntProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/training" element={<TrainingProgramPage />} />
          <Route path="/workout/:id" element={<WorkoutPage />} />

          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ai-workout" element={<AiWorkoutPage />} />
        </Routes>
      </AntProvider>
    </Router>
  );
}

export default App;
