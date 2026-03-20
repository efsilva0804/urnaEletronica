import { collection, query, orderBy, limit, getDocs, addDoc, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import CryptoJS from 'crypto-js';
import { Vote } from '../types';

export const generateVoteHash = (candidateId: string, timestamp: string, previousHash: string): string => {
  const data = `${candidateId}-${timestamp}-${previousHash}`;
  return CryptoJS.SHA256(data).toString();
};

export const generateCandidateHash = (name: string, number: string, party: string): string => {
  const data = `${name.trim()}-${number}-${party.trim()}`;
  return CryptoJS.SHA256(data).toString();
};

export const getLastVote = async (): Promise<Vote | null> => {
  const votesRef = collection(db, 'votes');
  const q = query(votesRef, orderBy('timestamp', 'desc'), limit(1));
  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Vote;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'votes');
    return null;
  }
};

export const registerVote = async (candidateId: string, voterId: string) => {
  const lastVote = await getLastVote();
  const previousHash = lastVote ? lastVote.hash : 'GENESIS_BLOCK';
  const timestamp = new Date().toISOString();
  const hash = generateVoteHash(candidateId, timestamp, previousHash);

  try {
    // 1. Record the vote in the "Boletim de Urna"
    await addDoc(collection(db, 'votes'), {
      candidateId,
      timestamp,
      hash,
      previousHash
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'votes');
  }

  try {
    // 2. Mark voter as "voted"
    const voterRef = doc(db, 'voters', voterId);
    await updateDoc(voterRef, { voted: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `voters/${voterId}`);
  }

  // 3. Update candidate vote count (if not blank/null)
  if (candidateId !== 'BLANK' && candidateId !== 'NULL') {
    const candidateRef = doc(db, 'candidates', candidateId);
    try {
      const candidateSnap = await getDoc(candidateRef);
      if (candidateSnap.exists()) {
        const currentVotes = candidateSnap.data().votesCount || 0;
        await updateDoc(candidateRef, { votesCount: currentVotes + 1 });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `candidates/${candidateId}`);
    }
  }

  try {
    // 4. Log the event
    await addDoc(collection(db, 'auditLogs'), {
      event: 'VOTO_REGISTRADO',
      timestamp: new Date().toISOString(),
      details: `Voto registrado com hash: ${hash.substring(0, 8)}...`
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'auditLogs');
  }
};

export const verifyChainIntegrity = async (): Promise<{ isValid: boolean; brokenAt?: string }> => {
  const votesRef = collection(db, 'votes');
  const q = query(votesRef, orderBy('timestamp', 'asc'));
  try {
    const snapshot = await getDocs(q);
    
    let expectedPreviousHash = 'GENESIS_BLOCK';
    
    for (const docSnap of snapshot.docs) {
      const vote = docSnap.data() as Vote;
      
      // Verify previous hash link
      if (vote.previousHash !== expectedPreviousHash) {
        return { isValid: false, brokenAt: docSnap.id };
      }
      
      // Re-calculate current hash
      const calculatedHash = generateVoteHash(vote.candidateId, vote.timestamp, vote.previousHash);
      if (vote.hash !== calculatedHash) {
        return { isValid: false, brokenAt: docSnap.id };
      }
      
      expectedPreviousHash = vote.hash;
    }
    
    return { isValid: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'votes');
    return { isValid: false };
  }
};
