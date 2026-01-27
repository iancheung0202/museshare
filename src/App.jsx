import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import Auth from './components/Auth';
import GroupManager from './components/GroupManager';
import PDFViewer from './components/PdfViewer';
import { ref, get, update, onValue } from 'firebase/database';
import { database } from './firebase/config';

function App() {
  const { currentUser, logout } = useAuth();
  const [currentGroup, setCurrentGroup] = useState(null);
  const [userGroups, setUserGroups] = useState([]);
  const [forceRefresh, setForceRefresh] = useState(0);

  const refreshGroups = useCallback(async () => {
    if (!currentUser) return;
    
    const userGroupsRef = ref(database, `users/${currentUser.uid}/groups`);
    const snapshot = await get(userGroupsRef);
    
    if (snapshot.exists()) {
      const groupIds = Object.keys(snapshot.val());
      const groupsData = await Promise.all(
        groupIds.map(async (gid) => {
          const groupSnap = await get(ref(database, `groups/${gid}`));
          return { id: gid, ...groupSnap.val() };
        })
      );
      setUserGroups(groupsData);
    } else {
      setUserGroups([]);
    }
  }, [currentUser]);

  useEffect(() => {
    refreshGroups();
  }, [currentUser, forceRefresh, refreshGroups]);

  useEffect(() => {
    if (!currentUser) return;

    const groupRefs = userGroups.map(group => 
      ref(database, `groups/${group.id}`)
    );

    const unsubscribes = groupRefs.map(groupRef => 
      onValue(groupRef, (snapshot) => {
        if (snapshot.exists()) {
          setUserGroups(prev => 
            prev.map(g => 
              g.id === snapshot.key ? {...g, ...snapshot.val()} : g
            )
          );
        }
      })
    );

    return () => unsubscribes.forEach(unsub => unsub());
    // Only run when currentUser changes, not userGroups
  }, [currentUser]);


  // Fetch user's groups
  useEffect(() => {
    if (!currentUser) return;

    const fetchUserGroups = async () => {
      const userGroupsRef = ref(database, `users/${currentUser.uid}/groups`);
      const snapshot = await get(userGroupsRef);
      if (snapshot.exists()) {
        const groupIds = Object.keys(snapshot.val());
        const groupsData = await Promise.all(
          groupIds.map(async (gid) => {
            const groupSnap = await get(ref(database, `groups/${gid}`));
            return { id: gid, ...groupSnap.val() };
          })
        );
        setUserGroups(groupsData);
      }
    };

    fetchUserGroups();
  }, [currentUser]);

  if (!currentUser) return <Auth />;

  // Show PDF Viewer if user joined a group
  if (currentGroup) {
    return (
      <PDFViewer 
        groupId={currentGroup} 
        onBack={() => setCurrentGroup(null)} 
      />
    );
  }

  // Function to add new group to local state
  const handleCreateGroup = (newGroup) => {
    setUserGroups(prevGroups => [...prevGroups, newGroup]);
  };
  

  
  // Helper function to sanitize keys
  const sanitizeKey = (key) => key.replace(/[.#$/\[\]]/g, '_');
  
  const leaveGroup = async (groupId) => {
    if (!window.confirm("Are you sure you want to leave this group?")) return;
    
    await update(ref(database), {
      [`groups/${groupId}/members/${sanitizeKey(currentUser.uid)}`]: null,
      [`users/${currentUser.uid}/groups/${groupId}`]: null
    });
    
    setUserGroups(prev => prev.filter(g => g.id !== groupId));
  };
  
  const deleteGroup = async (groupId) => {
    if (!window.confirm("Are you sure you want to delete this group?")) return;
    
    // Fetch group to get members
    const groupRef = ref(database, `groups/${groupId}`);
    const snapshot = await get(groupRef);
    
    if (snapshot.exists()) {
      const groupData = snapshot.val();
      const updates = {};
      
      // Remove group from each member
      Object.keys(groupData.members || {}).forEach(memberId => {
        updates[`users/${memberId}/groups/${groupId}`] = null;
      });
      
      // Remove group itself and annotations
      updates[`groups/${groupId}`] = null;
      updates[`annotations/${groupId}`] = null;
      
      await update(ref(database), updates);
      setUserGroups(prev => prev.filter(g => g.id !== groupId));
    }
  };

  return (
    <div className="app">
      <div className="welcome-page">
        <h2>Welcome, {currentUser.displayName || 'User'}! <button className='secondary' onClick={logout}>Logout</button></h2>
        
        <h3>Your Groups</h3>
        {userGroups.length === 0 && <p>You are not in any groups yet.</p>}
        <ul>
          <div className="group-list">
            {userGroups.map(group => {
              const isCreator = group.creator === sanitizeKey(currentUser.uid);
              const memberInfo = group.members?.[sanitizeKey(currentUser.uid)] || {};
              
              return (
                <div className="group-item" key={group.id} onClick={() => setCurrentGroup(group.id)}>
                  <li>
                    <strong>{group.name}</strong>{group.description ? ` — ${group.description}` : ''}
                    <br/>
                    <span className="join-date">
                      {isCreator
                        ? `Created on ${group.createdAt
                            ? new Date(group.createdAt).toLocaleDateString()
                            : 'Unknown date'}`
                        : `Joined on ${memberInfo.joinedAt
                            ? new Date(memberInfo.joinedAt).toLocaleDateString()
                            : 'Unknown date'}`
                      }
                    </span>
                    {/* <div className="group-actions">
                      {isCreator ? (
                        <button className="danger" onClick={() => deleteGroup(group.id)}>
                          Delete
                        </button>
                      ) : (
                        <button className="secondary" onClick={() => leaveGroup(group.id)}>
                          Leave
                        </button>
                      )}
                    </div> */}
                  </li>
                </div>
              );
            })}
          </div>
        </ul>
      </div>

      <GroupManager 
        user={currentUser} 
        onJoinGroup={(groupId) => {
          setCurrentGroup(groupId);
          setForceRefresh(prev => prev + 1);
        }}
        onCreateGroup={handleCreateGroup}
      />
    </div>
  );
}

export default App;
