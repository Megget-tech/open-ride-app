import React, { useEffect, useRef, useState } from 'react';
import {
  getUsers,
  getActiveUserId,
  createUser,
  switchUser,
  renameUser,
  deleteUser,
} from '../services/userManager';
import '../styles/user-switcher.css';

/** Returns up to 2 uppercase initials for a display name. */
function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Small colored avatar circle (button or static). */
function Avatar({ user, size = 'normal', onClick, title }) {
  const cls = `user-avatar${size === 'sm' ? ' user-avatar--sm' : ''}`;
  return (
    <button
      type="button"
      className={cls}
      style={{ backgroundColor: user.color }}
      onClick={onClick}
      title={title || user.name}
      aria-label={title || user.name}
    >
      {initials(user.name)}
    </button>
  );
}

/** The full UserSwitcher component: avatar button + dropdown panel. */
export default function UserSwitcher({ interactive = true }) {
  const [users, setUsers]           = useState(() => getUsers());
  const [activeId, setActiveId]     = useState(() => getActiveUserId());
  const [open, setOpen]             = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [newName, setNewName]       = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const wrapperRef = useRef(null);
  const newNameInputRef = useRef(null);
  const renameInputRef = useRef(null);

  const activeUser = users.find(u => u.id === activeId);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus new-name input when it appears
  useEffect(() => {
    if (addingUser && newNameInputRef.current) {
      newNameInputRef.current.focus();
    }
  }, [addingUser]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  if (!activeUser) return null;

  // Non-interactive mode: just show the avatar circle with no dropdown
  if (!interactive) {
    return <Avatar user={activeUser} size="sm" />;
  }

  function handleAvatarClick() {
    setOpen(o => !o);
    setAddingUser(false);
    setRenamingId(null);
  }

  function handleSwitch(id) {
    if (id === activeId) { setOpen(false); return; }
    switchUser(id);
    window.location.reload();
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    createUser(name);
    window.location.reload();
  }

  function handleAddKeyDown(e) {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') { setAddingUser(false); setNewName(''); }
  }

  function startRename(user, e) {
    e.stopPropagation();
    setRenamingId(user.id);
    setRenameValue(user.name);
    setAddingUser(false);
  }

  function commitRename() {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    renameUser(renamingId, renameValue);
    setUsers(getUsers());
    setRenamingId(null);
  }

  function handleRenameKeyDown(e) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setRenamingId(null);
  }

  function handleDelete(id, e) {
    e.stopPropagation();
    if (!deleteUser(id)) return;
    setUsers(getUsers());
  }

  return (
    <div className="user-switcher-wrapper" ref={wrapperRef}>
      <Avatar user={activeUser} onClick={handleAvatarClick} title={`${activeUser.name} — switch profile`} />

      {open && (
        <div className="user-switcher-panel" role="dialog" aria-label="User profiles">
          <div className="user-switcher-panel-header">Profiles</div>

          <ul className="user-switcher-list">
            {users.map(user => {
              const isActive   = user.id === activeId;
              const isRenaming = renamingId === user.id;

              return (
                <li key={user.id}>
                  {isRenaming ? (
                    <div className="user-switcher-rename-row">
                      <Avatar user={user} size="sm" />
                      <input
                        ref={renameInputRef}
                        className="user-switcher-name-input"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        maxLength={30}
                        aria-label="New name"
                      />
                      <button className="user-switcher-confirm-btn" onClick={commitRename}>OK</button>
                      <button className="user-switcher-cancel-btn" onClick={() => setRenamingId(null)}>✕</button>
                    </div>
                  ) : (
                    <div
                      className={`user-switcher-item${isActive ? ' user-switcher-item--active' : ''}`}
                      onClick={() => handleSwitch(user.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handleSwitch(user.id)}
                    >
                      <Avatar user={user} size="sm" />
                      <span className={`user-switcher-item-name${isActive ? ' user-switcher-item-name--active' : ''}`}>
                        {user.name}
                      </span>
                      {isActive && <span className="user-switcher-check" aria-label="Active">✓</span>}
                      <div className="user-switcher-actions" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          className="user-switcher-icon-btn"
                          onClick={e => startRename(user, e)}
                          title="Rename"
                          aria-label={`Rename ${user.name}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                          </svg>
                        </button>
                        {!isActive && users.length > 1 && (
                          <button
                            type="button"
                            className="user-switcher-icon-btn user-switcher-icon-btn--danger"
                            onClick={e => handleDelete(user.id, e)}
                            title="Delete profile"
                            aria-label={`Delete ${user.name}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="user-switcher-footer">
            {addingUser ? (
              <div className="user-switcher-add-form">
                <div className="user-switcher-rename-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <input
                    ref={newNameInputRef}
                    className="user-switcher-name-input"
                    placeholder="Name…"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={handleAddKeyDown}
                    maxLength={30}
                    aria-label="New profile name"
                  />
                  <button className="user-switcher-confirm-btn" onClick={handleAdd}>Add</button>
                  <button className="user-switcher-cancel-btn" onClick={() => { setAddingUser(false); setNewName(''); }}>✕</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="user-switcher-add-btn"
                onClick={() => { setAddingUser(true); setRenamingId(null); }}
              >
                <span className="user-switcher-add-icon">+</span>
                Add profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
