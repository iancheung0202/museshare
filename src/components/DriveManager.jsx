// DriveManager.jsx
import { useState, useEffect, useRef } from 'react';
import { ref, update } from 'firebase/database';
import { database } from '../firebase/config';
import { useAuth } from '../context/AuthContext';

export default function DriveManager({ groupId, onFileAdded }) {
  const { currentUser } = useAuth();
  const tokenClientRef = useRef(null); // store token client persistently
  const [isLoading, setIsLoading] = useState(false);
  const [googleApiLoaded, setGoogleApiLoaded] = useState(false);
  const [accessToken, setAccessToken] = useState(null);

  const CLIENT_ID = '473021815397-c9ckf9pm5q451spl3urnb0mgtcpe9cs2.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyCCqAoW0dtp-KNCdnhAeqBpoOhE4Ir_0x4';
  const SCOPES = 'https://www.googleapis.com/auth/drive';

  let tokenClient;

  // Load Google APIs
  useEffect(() => {
    const loadScripts = () => {
      // Picker API
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => window.gapi.load('picker', () => setGoogleApiLoaded(true));
      document.body.appendChild(script);

      // GIS API
      const gisScript = document.createElement('script');
        gisScript.src = 'https://accounts.google.com/gsi/client';
        gisScript.onload = () => {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => setAccessToken(tokenResponse.access_token),
        });
      };
      document.body.appendChild(gisScript);
    };

    loadScripts();
  }, []);

  const importFromDrive = async () => {
    if (!googleApiLoaded) {
        alert('Google API not loaded yet');
        return;
    }

    setIsLoading(true);

    // Wait for token client to be ready
    if (!accessToken) {
        if (!tokenClientRef.current) {
        alert('Google token client is not ready yet, please wait a moment.');
        setIsLoading(false);
        return;
        }
        tokenClientRef.current.requestAccessToken();
        setIsLoading(false);
        return;
    }

    openPicker(accessToken);
  };


  const makeFilePublic = async (fileId, token) => {
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      });
    } catch (err) {
      console.error('Failed to make file public:', err);
    }
  };

  const openPicker = (oauthToken) => {
    const picker = new window.google.picker.PickerBuilder()
      .setDeveloperKey(API_KEY)
      .setOAuthToken(oauthToken)
      .addView(
        new window.google.picker.DocsView()
          .setIncludeFolders(true)
          .setMimeTypes('application/pdf')
          .setSelectFolderEnabled(false)
      )
      .setCallback((data) => pickerCallback(data, oauthToken))
      .build();

    picker.setVisible(true);
  };

  const pickerCallback = async (data, oauthToken) => {
    if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.PICKED) {
      const doc = data[window.google.picker.Response.DOCUMENTS][0];
      const fileId = doc.id;
      const fileName = doc.name;

      await update(ref(database, `groups/${groupId}/files/${fileId}`), {
        name: fileName,
        owner: currentUser.uid,
        addedAt: Date.now(),
        driveId: fileId,
      });

      await makeFilePublic(fileId, oauthToken);
      onFileAdded();
    }

    setIsLoading(false);
  };

  return (
    <div className="card mb-6">
      <h3>PDF Files</h3>
      <button
        onClick={importFromDrive}
        disabled={isLoading || !googleApiLoaded}
        className="flex items-center gap-2"
      >
        {isLoading ? (
          <div className="loading-spinner"></div>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        )}
        Import PDF from Google Drive
      </button>
      {!googleApiLoaded && <p className="text-sm text-gray-400 mt-2">Loading Google Drive API...</p>}
    </div>
  );
}
