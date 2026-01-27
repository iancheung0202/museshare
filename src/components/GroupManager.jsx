import { useState, useEffect } from 'react';
import { ref, get, update, set } from 'firebase/database';
import { database } from '../firebase/config';

export default function GroupManager({ user, onJoinGroup, onCreateGroup }) {
  const [groupCodeInput, setGroupCodeInput] = useState('');
  const [joinPreview, setJoinPreview] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  // Generate unique 8-digit numeric code
  const generate8DigitCode = () => {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  };

  const sanitizeKey = (key) => key.replace(/[.#$/\[\]]/g, '_');

  const createGroup = async () => {
    if (!groupName) {
      alert('Please enter a group name');
      return;
    }

    const groupId = generate8DigitCode();
    const createdAt = Date.now();

    await set(ref(database, `groups/${groupId}`), {
      name: groupName,
      description: groupDescription || '',
      createdAt,
      creator: sanitizeKey(user.uid),
      members: { 
        [sanitizeKey(user.uid)]: {
          name: user.displayName,
          joinedAt: createdAt,
          isCreator: true
        }
      },
      files: {} // Initialize empty files collection
    });

    // Add group to user's list
    await set(ref(database, `users/${user.uid}/groups/${groupId}`), true);

    // Notify parent component about the new group
    onCreateGroup({
      id: groupId,
      name: groupName,
      description: groupDescription,
      createdAt
    });

    onJoinGroup(groupId);
  };

  const joinGroup = async () => {
    const groupRef = ref(database, `groups/${groupCodeInput}`);
    const snapshot = await get(groupRef);

    if (!snapshot.exists()) {
      alert('Group not found!');
      return;
    }

    const groupData = snapshot.val();
    setJoinPreview(groupData);

    // Add member
    await update(ref(database), {
      [`groups/${groupCodeInput}/members/${sanitizeKey(user.uid)}`]: {
        name: user.displayName,
        joinedAt: Date.now(),
        isCreator: false
      },
      [`users/${user.uid}/groups/${groupCodeInput}`]: true
    });

    onJoinGroup(groupCodeInput);
  };

  // Auto-show group info while typing 8-digit code
  useEffect(() => {
    const fetchGroupPreview = async () => {
      if (groupCodeInput.length !== 8) {
        setJoinPreview(null);
        return;
      }
      const snap = await get(ref(database, `groups/${groupCodeInput}`));
      setJoinPreview(snap.exists() ? snap.val() : null);
    };
    fetchGroupPreview();
  }, [groupCodeInput]);

  return (
    <div className="group-manager card">
      <div className="group-manager card">
        <h3>Create a New Group</h3>
        <input 
            type="text" 
            placeholder="Group Name" 
            value={groupName} 
            onChange={(e) => setGroupName(e.target.value)} 
            style={{ fontWeight: 'bold' }}
        />
        <input 
            type="text" 
            placeholder="Description (optional)" 
            value={groupDescription} 
            onChange={(e) => setGroupDescription(e.target.value)} 
        />
        <button onClick={createGroup}>Create Group</button>
      </div>
      <br></br>
      <div className="group-manager card">
        <h3>Join a Group</h3>
        <input 
            type="text" 
            placeholder="Enter 8-digit group code" 
            value={groupCodeInput} 
            onChange={(e) => setGroupCodeInput(e.target.value)} 
        />
        {joinPreview && (
            <div className="join-preview">
                <strong>{joinPreview.name}</strong>
                {joinPreview.description ? ` — ${joinPreview.description}` : ''}
                <br />
                Created: {new Date(joinPreview.createdAt).toLocaleDateString()}
            </div>
        )}
        <button className='success' onClick={joinGroup} disabled={groupCodeInput.length !== 8}>Join Group</button>
      </div>
    </div>
  );
}
