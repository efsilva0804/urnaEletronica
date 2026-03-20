export interface Candidate {
  id: string;
  name: string;
  number: string;
  party: string;
  photoUrl: string;
  votesCount: number;
  candidateHash?: string;
}

export interface Voter {
  id: string;
  ra: string;
  name: string;
  class: string;
  voted: boolean;
}

export interface Vote {
  id: string;
  candidateId: string | 'BLANK' | 'NULL';
  timestamp: string;
  hash: string;
  previousHash: string;
}

export interface AuditLog {
  id: string;
  event: string;
  timestamp: string;
  details: string;
}

export interface UrnaStatus {
  id: string;
  isOpen: boolean;
  startTime?: string;
  endTime?: string;
}
