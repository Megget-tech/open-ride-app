/**
 * Notification system for displaying user-friendly messages
 */

class Notification {
  static show(message, type = 'info', duration = 4000) {
    // Remove any existing notifications
    const existing = document.querySelector('.notification-toast');
    if (existing) {
      existing.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification-toast notification-${type}`;

    // Determine icon based on type
    let icon = '';
    switch (type) {
      case 'error':
        icon = '⚠️';
        break;
      case 'success':
        icon = '✓';
        break;
      case 'warning':
        icon = '⚠';
        break;
      default:
        icon = 'ℹ';
    }

    notification.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-message">${message}</div>
      </div>
      <button class="notification-close" onclick="this.parentElement.remove()">✕</button>
    `;

    // Add to body
    document.body.appendChild(notification);

    // Trigger animation
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    // Auto-remove after duration (if not 0)
    if (duration > 0) {
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
          if (notification.parentElement) {
            notification.remove();
          }
        }, 300);
      }, duration);
    }

    return notification;
  }

  static error(message, duration = 5000) {
    return this.show(message, 'error', duration);
  }

  static success(message, duration = 3000) {
    return this.show(message, 'success', duration);
  }

  static warning(message, duration = 4000) {
    return this.show(message, 'warning', duration);
  }

  static info(message, duration = 4000) {
    return this.show(message, 'info', duration);
  }

  /**
   * Show a confirmation modal with Yes/No options
   */
  static confirm(message, onConfirm, onCancel) {
    // Create modal backdrop
    const modal = document.createElement('div');
    modal.className = 'notification-modal';
    modal.innerHTML = `
      <div class="notification-modal-backdrop"></div>
      <div class="notification-modal-content">
        <div class="notification-modal-icon">⚠️</div>
        <div class="notification-modal-message">${message}</div>
        <div class="notification-modal-actions">
          <button class="notification-btn notification-btn-secondary" id="modal-cancel">Cancel</button>
          <button class="notification-btn notification-btn-primary" id="modal-confirm">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Show modal
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);

    // Handle confirm
    modal.querySelector('#modal-confirm').addEventListener('click', () => {
      modal.classList.remove('show');
      setTimeout(() => modal.remove(), 300);
      if (onConfirm) onConfirm();
    });

    // Handle cancel
    const cancelHandler = () => {
      modal.classList.remove('show');
      setTimeout(() => modal.remove(), 300);
      if (onCancel) onCancel();
    };

    modal.querySelector('#modal-cancel').addEventListener('click', cancelHandler);
    modal.querySelector('.notification-modal-backdrop').addEventListener('click', cancelHandler);

    // ESC key to cancel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        cancelHandler();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Notification;
}
