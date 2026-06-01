import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase/config';

export default function Auth() {
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    // Add Google Drive scope
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google", error);
    }
  };

  return (
    <div className="auth-container">
        <h1>MuseShare</h1>
        <p className="mb-6">Collaborative score annotation platform</p>
        <button onClick={signInWithGoogle}>
        Sign in with Google
        </button>
    </div>
  );
}