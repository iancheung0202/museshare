import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCCqAoW0dtp-KNCdnhAeqBpoOhE4Ir_0x4",
  authDomain: "museshare-web.firebaseapp.com",
  databaseURL: "https://museshare-web-default-rtdb.firebaseio.com",
  projectId: "museshare-web",
  storageBucket: "museshare-web.appspot.com",
  messagingSenderId: "473021815397",
  appId: "1:473021815397:web:eec77a6d1e55b2902e048c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const provider = new GoogleAuthProvider();

export { auth, database, provider };