// src/utils/tokenManager.js
const TOKEN_KEY = 'google_oauth_token';
const EXPIRATION_KEY = 'google_oauth_token_expiration';

export const getGoogleToken = async () => {
  // Check if token exists and is still valid
  const storedToken = localStorage.getItem(TOKEN_KEY);
  const expiration = localStorage.getItem(EXPIRATION_KEY);
  
  if (storedToken && expiration && Date.now() < parseInt(expiration, 10)) {
    return storedToken;
  }

  // Request new token if expired or missing
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts) {
      reject('Google API not loaded');
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: '473021815397-c9ckf9pm5q451spl3urnb0mgtcpe9cs2.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (tokenResponse) => {
        if (tokenResponse.access_token) {
          // Calculate expiration time (1 hour - 5 minutes buffer)
          const expiresIn = tokenResponse.expires_in || 3600;
          const expirationTime = Date.now() + (expiresIn - 300) * 1000;
          
          // Store token and expiration
          localStorage.setItem(TOKEN_KEY, tokenResponse.access_token);
          localStorage.setItem(EXPIRATION_KEY, expirationTime.toString());
          
          resolve(tokenResponse.access_token);
        } else {
          reject('Failed to get access token');
        }
      },
    });

    tokenClient.requestAccessToken();
  });
};

// Clear token on logout or when needed
export const clearGoogleToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRATION_KEY);
};