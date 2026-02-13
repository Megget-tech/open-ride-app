/**
 * Shared ANT+ Manager instance
 * This module provides a singleton ANT manager that can be imported by all pages
 */

import { AntManagerWebUSB } from './antManagerWebUSB.js';
import { AntManagerEmulator } from './antManagerEmulator.js';

// Create singleton instance
let antManagerInstance = null;

// Check for emulator mode from URL parameter or localStorage
function shouldUseEmulator() {
  // Check URL parameter first (for easy testing)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('emulator')) {
    return urlParams.get('emulator') === 'true';
  }

  // Check localStorage
  const stored = localStorage.getItem('openride_use_emulator');
  return stored === 'true';
}

/**
 * Get or create the ANT manager instance
 * Uses emulator if ?emulator=true is in URL or localStorage has openride_use_emulator=true
 * Automatically reconnects if USB permissions were previously granted
 */
export function getAntManager() {
  if (!antManagerInstance) {
    const useEmulator = shouldUseEmulator();

    if (useEmulator) {
      antManagerInstance = new AntManagerEmulator();
      console.log('🎮 Created ANT+ Emulator instance (no hardware required)');

      // Auto-connect emulator
      setTimeout(() => {
        antManagerInstance.initialize();
      }, 100);
    } else {
      antManagerInstance = new AntManagerWebUSB();
      console.log('Created ANT+ WebUSB Manager instance');

      // Auto-reconnect if we had a previous connection
      const wasConnected = localStorage.getItem('openride_was_connected');
      if (wasConnected === 'true') {
        console.log('Previous connection detected, attempting to reconnect...');
        setTimeout(async () => {
          const success = await antManagerInstance.initialize();
          if (success) {
            console.log('✅ Automatically reconnected to USB dongle');
          } else {
            console.log('Failed to auto-reconnect. Please reconnect manually.');
            localStorage.removeItem('openride_was_connected');
          }
        }, 100);
      }
    }
  }
  return antManagerInstance;
}

/**
 * Check if using emulator
 */
export function isEmulatorMode() {
  return shouldUseEmulator();
}

/**
 * Set emulator mode (saves to localStorage)
 */
export function setEmulatorMode(enabled) {
  localStorage.setItem('openride_use_emulator', enabled ? 'true' : 'false');
  console.log(`Emulator mode ${enabled ? 'enabled' : 'disabled'}. Reload page to apply.`);
}

/**
 * Initialize ANT manager if not already connected
 * Returns true if already connected or successfully connected
 */
export async function ensureConnected() {
  const manager = getAntManager();

  if (manager.dongleStatus === 'connected') {
    return true;
  }

  const initialized = await manager.initialize();
  if (!initialized) {
    console.error('Failed to initialize ANT+ USB dongle');
  }
  return initialized;
}
