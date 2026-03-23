import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { Candidate, Voter, AuditLog, UrnaStatus } from '../types';
import { verifyChainIntegrity, generateCandidateHash } from '../services/votingService';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Plus, Trash2, ShieldCheck, ShieldAlert, History, Users, UserPlus, Power, PowerOff, RefreshCw, FileText, FileJson, Upload, Download, FileUp, ImagePlus, FileSpreadsheet, RotateCcw, AlertTriangle, Search, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { motion, AnimatePresence } from 'motion/react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export function AdminDashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [urnaStatus, setUrnaStatus] = useState<UrnaStatus | null>(null);
  const [integrity, setIntegrity] = useState<{ isValid: boolean; brokenAt?: string } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showModal, setShowModal] = useState<{
    show: boolean;
    type: 'restart' | 'full' | 'clearVoters' | null;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({
    show: false,
    type: null,
    title: '',
    message: '',
    action: async () => {}
  });
  const candidateFileRef = useRef<HTMLInputElement>(null);
  const voterFileRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [newCandidate, setNewCandidate] = useState({ name: '', number: '', party: '', photoUrl: '' });
  const [candidatePhoto, setCandidatePhoto] = useState<File | null>(null);
  const [newVoter, setNewVoter] = useState({ ra: '', name: '', class: '' });
  const [candidateSearch, setCandidateSearch] = useState('');
  const [voterSearch, setVoterSearch] = useState('');

  useEffect(() => {
    const unsubCandidates = onSnapshot(collection(db, 'candidates'), (snap) => {
      setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Candidate)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'candidates');
    });
    const unsubVoters = onSnapshot(collection(db, 'voters'), (snap) => {
      setVoters(snap.docs.map(d => ({ id: d.id, ...d.data() } as Voter)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'voters');
    });
    const unsubLogs = onSnapshot(query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc')), (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'auditLogs');
    });
    const unsubStatus = onSnapshot(doc(db, 'urnaStatus', 'global'), (snap) => {
      if (snap.exists()) setUrnaStatus(snap.data() as UrnaStatus);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'urnaStatus/global');
    });

    return () => {
      unsubCandidates();
      unsubVoters();
      unsubLogs();
      unsubStatus();
    };
  }, []);

  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    let photoUrl = newCandidate.photoUrl;
    
    if (candidatePhoto) {
      try {
        const storageRef = ref(storage, `candidates/${Date.now()}_${candidatePhoto.name}`);
        const snapshot = await uploadBytes(storageRef, candidatePhoto);
        photoUrl = await getDownloadURL(snapshot.ref);
      } catch (error) {
        console.error("Error uploading photo:", error);
        alert("Erro ao fazer upload da foto. Tente novamente.");
        setIsSubmitting(false);
        return;
      }
    }

    const candidateHash = generateCandidateHash(newCandidate.name, newCandidate.number, newCandidate.party);
    
    try {
      await addDoc(collection(db, 'candidates'), { 
        ...newCandidate, 
        photoUrl,
        votesCount: 0,
        candidateHash 
      });
      
      setNewCandidate({ name: '', number: '', party: '', photoUrl: '' });
      setCandidatePhoto(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'candidates');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddVoter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'voters'), { ...newVoter, voted: false });
      setNewVoter({ ra: '', name: '', class: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'voters');
    }
  };

  const handleImportCandidates = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const typedarray = new Uint8Array(reader.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }
          
          const lines = fullText.split('\n');
          const candidatesToImport: any[] = [];
          
          lines.forEach(line => {
            // More robust regex for candidates: Number Name Party
            // Example: "99 Candidato Exemplo Partido" or "Candidato Exemplo 99 Partido"
            const match = line.match(/(.+)\s+(\d{2,5})\s+(.+)/) || line.match(/(\d{2,5})\s+(.+)\s+(.+)/);
            if (match) {
              let name, number, party;
              if (match[2].length <= 5 && !isNaN(Number(match[2]))) {
                name = match[1].trim();
                number = match[2];
                party = match[3].trim();
              } else {
                number = match[1];
                name = match[2].trim();
                party = match[3].trim();
              }
              
              const candidateHash = generateCandidateHash(name, number, party);
              candidatesToImport.push({
                name,
                number,
                party,
                photoUrl: '',
                votesCount: 0,
                candidateHash
              });
            }
          });

          if (candidatesToImport.length === 0) {
            alert('Nenhum candidato encontrado no PDF. Verifique o formato.');
            return;
          }

          // Chunked commit
          for (let i = 0; i < candidatesToImport.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = candidatesToImport.slice(i, i + 500);
            chunk.forEach(data => {
              const docRef = doc(collection(db, 'candidates'));
              batch.set(docRef, data);
            });
            await batch.commit();
          }

          alert(`${candidatesToImport.length} candidatos importados do PDF com sucesso!`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'candidates');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.toLowerCase().trim(),
      complete: async (results) => {
        const candidatesToImport: any[] = [];
        results.data.forEach((row: any) => {
          if (row.name && row.number) {
            const name = row.name;
            const number = row.number;
            const party = row.party || '';
            const candidateHash = generateCandidateHash(name, number, party);
            
            candidatesToImport.push({
              name,
              number,
              party,
              photoUrl: row.photourl || row.photo_url || '',
              votesCount: 0,
              candidateHash
            });
          }
        });

        if (candidatesToImport.length === 0) {
          alert('Nenhum candidato válido encontrado no CSV. Verifique os cabeçalhos (name, number, party).');
          return;
        }

        try {
          for (let i = 0; i < candidatesToImport.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = candidatesToImport.slice(i, i + 500);
            chunk.forEach(data => {
              const docRef = doc(collection(db, 'candidates'));
              batch.set(docRef, data);
            });
            await batch.commit();
          }
          alert(`${candidatesToImport.length} candidatos importados com sucesso!`);
          if (candidateFileRef.current) candidateFileRef.current.value = '';
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'candidates');
        }
      }
    });
  };

  const handleImportVoters = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const typedarray = new Uint8Array(reader.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }

          const lines = fullText.split('\n');
          const votersToImport: any[] = [];
          let currentClass = 'Geral';
          
          lines.forEach(line => {
            if (line.includes('Turma:')) {
              currentClass = line.split('Turma:')[1].trim();
            } else {
              // Match RA - Name pattern (more flexible)
              const match = line.match(/(\d+)\s*[-–]\s*([^\[\n]+)/);
              if (match) {
                votersToImport.push({
                  ra: match[1].trim(),
                  name: match[2].trim(),
                  class: currentClass,
                  voted: false
                });
              }
            }
          });

          if (votersToImport.length === 0) {
            alert('Nenhum eleitor encontrado no PDF. Verifique o formato (RA - Nome).');
            return;
          }

          // Chunked commit
          for (let i = 0; i < votersToImport.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = votersToImport.slice(i, i + 500);
            chunk.forEach(data => {
              const docRef = doc(collection(db, 'voters'));
              batch.set(docRef, data);
            });
            await batch.commit();
          }
          
          alert(`${votersToImport.length} eleitores importados do PDF com sucesso!`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'voters');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.toLowerCase().trim(),
      complete: async (results) => {
        const votersToImport: any[] = [];
        results.data.forEach((row: any) => {
          // Flexible header matching
          const ra = row.ra || row.registro || row.id;
          const name = row.name || row.nome;
          const className = row.class || row.turma || row.sala;

          if (ra && name && className) {
            votersToImport.push({
              ra: String(ra).trim(),
              name: String(name).trim(),
              class: String(className).trim(),
              voted: false
            });
          }
        });

        if (votersToImport.length === 0) {
          alert('Nenhum eleitor válido encontrado no CSV. Verifique os cabeçalhos (ra, name, class).');
          return;
        }

        try {
          for (let i = 0; i < votersToImport.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = votersToImport.slice(i, i + 500);
            chunk.forEach(data => {
              const docRef = doc(collection(db, 'voters'));
              batch.set(docRef, data);
            });
            await batch.commit();
          }
          alert(`${votersToImport.length} eleitores importados com sucesso!`);
          if (voterFileRef.current) voterFileRef.current.value = '';
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'voters');
        }
      }
    });
  };

  const downloadTemplate = (type: 'candidates' | 'voters') => {
    let csv = '';
    if (type === 'candidates') {
      csv = 'name,number,party,photoUrl\nCandidato Exemplo,99,Partido Exemplo,https://link-da-foto.jpg';
    } else {
      csv = 'ra,name,class\n2024001,Aluno Exemplo,3A';
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${type}.csv`;
    a.click();
  };

  const handleRestartVoting = async () => {
    setIsResetting(true);
    setShowModal(prev => ({ ...prev, show: false }));
    try {
      const votesSnap = await getDocs(collection(db, 'votes')).catch(e => handleFirestoreError(e, OperationType.GET, 'votes'));
      const votersSnap = await getDocs(collection(db, 'voters')).catch(e => handleFirestoreError(e, OperationType.GET, 'voters'));
      const candidatesSnap = await getDocs(collection(db, 'candidates')).catch(e => handleFirestoreError(e, OperationType.GET, 'candidates'));
      const logsSnap = await getDocs(collection(db, 'auditLogs')).catch(e => handleFirestoreError(e, OperationType.GET, 'auditLogs'));

      if (!votesSnap || !votersSnap || !candidatesSnap || !logsSnap) return;

      interface BatchOp {
        type: string;
        ref: any;
        data?: any;
        options?: any;
      }

      const allOps: BatchOp[] = [
        ...votesSnap.docs.map(d => ({ type: 'delete', ref: d.ref })),
        ...votersSnap.docs.map(d => ({ type: 'update', ref: d.ref, data: { voted: false } })),
        ...candidatesSnap.docs.map(d => ({ type: 'update', ref: d.ref, data: { votesCount: 0 } })),
        ...logsSnap.docs.map(d => ({ type: 'delete', ref: d.ref })),
        { 
          type: 'set', 
          ref: doc(db, 'urnaStatus', 'global'), 
          data: { isOpen: false, startTime: null, endTime: null },
          options: { merge: true }
        }
      ];

      // Process in chunks of 500
      for (let i = 0; i < allOps.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = allOps.slice(i, i + 500);
        
        chunk.forEach(op => {
          if (op.type === 'delete') batch.delete(op.ref);
          if (op.type === 'update') batch.update(op.ref, op.data!);
          if (op.type === 'set') batch.set(op.ref, op.data!, op.options);
        });
        
        await batch.commit().catch(e => handleFirestoreError(e, OperationType.WRITE, 'batch_reset'));
      }

      // 5. Add audit log
      await addDoc(collection(db, 'auditLogs'), {
        event: 'REINICIALIZAÇÃO DA VOTAÇÃO',
        timestamp: new Date().toISOString(),
        details: `Votação reiniciada. Votos zerados, mas cadastros mantidos.`
      }).catch(e => handleFirestoreError(e, OperationType.WRITE, 'auditLogs'));

      setIntegrity(null);
      alert('Votação reiniciada com sucesso! Os cadastros foram preservados.');
    } catch (error) {
      console.error('Error restarting voting:', error);
      alert('Erro ao reiniciar votação.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleClearVoters = async () => {
    setIsResetting(true);
    setShowModal(prev => ({ ...prev, show: false }));
    try {
      const votersSnap = await getDocs(collection(db, 'voters'));
      const batch = writeBatch(db);
      votersSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      await addDoc(collection(db, 'auditLogs'), {
        event: 'LIMPEZA DE ELEITORES',
        timestamp: new Date().toISOString(),
        details: `Todos os eleitores foram removidos pelo administrador.`
      });

      alert('Todos os dados dos eleitores foram apagados com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'clear_voters');
    } finally {
      setIsResetting(false);
    }
  };

  const handleFullReset = async () => {
    setIsResetting(true);
    setShowModal(prev => ({ ...prev, show: false }));
    try {
      const votesSnap = await getDocs(collection(db, 'votes'));
      const votersSnap = await getDocs(collection(db, 'voters'));
      const candidatesSnap = await getDocs(collection(db, 'candidates'));
      const logsSnap = await getDocs(collection(db, 'auditLogs'));

      const batch = writeBatch(db);
      
      // Delete everything
      votesSnap.docs.forEach(d => batch.delete(d.ref));
      votersSnap.docs.forEach(d => batch.delete(d.ref));
      candidatesSnap.docs.forEach(d => batch.delete(d.ref));
      logsSnap.docs.forEach(d => batch.delete(d.ref));
      
      batch.set(doc(db, 'urnaStatus', 'global'), { 
        isOpen: false, 
        startTime: null, 
        endTime: null 
      }, { merge: true });

      await batch.commit();
      
      await addDoc(collection(db, 'auditLogs'), {
        event: 'LIMPEZA TOTAL DA BASE',
        timestamp: new Date().toISOString(),
        details: `Toda a base de dados foi apagada pelo administrador.`
      });

      alert('Toda a base de dados foi limpa com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'full_reset');
    } finally {
      setIsResetting(false);
    }
  };

  const toggleUrna = async () => {
    try {
      const statusRef = doc(db, 'urnaStatus', 'global');
      const newState = !urnaStatus?.isOpen;
      await updateDoc(statusRef, { 
        isOpen: newState,
        [newState ? 'startTime' : 'endTime']: new Date().toISOString()
      });
      
      await addDoc(collection(db, 'auditLogs'), {
        event: newState ? 'URNA_ABERTA' : 'URNA_FECHADA',
        timestamp: new Date().toISOString(),
        details: `Urna ${newState ? 'aberta' : 'fechada'} pelo administrador.`
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'urnaStatus/auditLogs');
    }
  };

  const checkIntegrity = async () => {
    setIsChecking(true);
    const result = await verifyChainIntegrity();
    setIntegrity(result);
    setIsChecking(false);
  };

  const exportVotersPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Lista de Eleitores - Urna Escolar', 20, 20);
    doc.setFontSize(10);
    let y = 30;
    
    // Group by class
    const classes = [...new Set(voters.map(v => v.class))].sort();
    
    classes.forEach(className => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(`Turma: ${className}`, 20, y);
      y += 7;
      doc.setFontSize(10);
      
      const classVoters = voters.filter(v => v.class === className).sort((a, b) => a.name.localeCompare(b.name));
      classVoters.forEach(v => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(`${v.ra} - ${v.name} [${v.voted ? 'VOTOU' : 'Pendente'}]`, 30, y);
        y += 5;
      });
      y += 5;
    });
    
    doc.save(`lista_eleitores_${new Date().getTime()}.pdf`);
  };

  const exportVotersTXT = () => {
    let content = "LISTA DE ELEITORES - URNA ESCOLAR\n";
    content += `Data: ${new Date().toLocaleString()}\n\n`;
    
    const classes = [...new Set(voters.map(v => v.class))].sort();
    classes.forEach(className => {
      content += `TURMA: ${className}\n`;
      content += "------------------------------------------\n";
      const classVoters = voters.filter(v => v.class === className).sort((a, b) => a.name.localeCompare(b.name));
      classVoters.forEach(v => {
        content += `${v.ra.padEnd(10)} | ${v.name.padEnd(30)} | ${v.voted ? 'VOTOU' : 'Pendente'}\n`;
      });
      content += "\n";
    });
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista_eleitores_${new Date().getTime()}.txt`;
    a.click();
  };

  const exportLogsCSV = () => {
    const csvData = logs.map(log => ({
      Data: new Date(log.timestamp).toLocaleString(),
      Evento: log.event,
      Detalhes: log.details
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_${new Date().getTime()}.csv`;
    a.click();
  };

  const exportLogsPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Log de Auditoria - Urna Escolar', 20, 20);
    doc.setFontSize(8);
    let y = 30;

    logs.forEach((log, index) => {
      if (y > 280) { doc.addPage(); y = 20; }
      const date = new Date(log.timestamp).toLocaleString();
      doc.setFont('helvetica', 'bold');
      doc.text(`${date} - ${log.event}`, 20, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      const details = doc.splitTextToSize(log.details, 170);
      doc.text(details, 25, y);
      y += (details.length * 4) + 2;
    });

    doc.save(`audit_logs_${new Date().getTime()}.pdf`);
  };

  return (
    <div className="space-y-12">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
        <div>
          <h1 className="text-3xl font-bold text-white">Painel de Controle</h1>
          <p className="text-zinc-500">Administração e Auditoria da Eleição</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={checkIntegrity}
            disabled={isChecking || isResetting}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none ${integrity?.isValid ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/50' : integrity?.isValid === false ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-zinc-800 text-zinc-300'}`}
            aria-label="Verificar integridade da cadeia de votos"
          >
            {isChecking ? <RefreshCw className="w-5 h-5 animate-spin" /> : integrity?.isValid ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            {isChecking ? 'Verificando...' : integrity ? (integrity.isValid ? 'Integridade OK' : 'Falha na Cadeia') : 'Verificar Integridade'}
          </button>
          
          <button
            onClick={() => setShowModal({
              show: true,
              type: 'restart',
              title: 'Reiniciar Votação',
              message: 'Deseja zerar os votos e permitir uma nova eleição? Os candidatos e eleitores cadastrados serão mantidos.',
              action: handleRestartVoting
            })}
            disabled={isResetting || isChecking}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
            title="Zerar votos e permitir nova votação mantendo candidatos e eleitores"
            aria-label="Reiniciar votação mantendo cadastros"
          >
            {isResetting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
            Reiniciar Votação
          </button>

          <button
            onClick={() => setShowModal({
              show: true,
              type: 'full',
              title: 'Limpeza Total',
              message: 'ATENÇÃO: Deseja apagar permanentemente TUDO (Votos, Candidatos, Eleitores e Logs)? Esta ação não pode ser desfeita e limpará toda a base de dados para uma nova configuração.',
              action: handleFullReset
            })}
            disabled={isResetting || isChecking}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-red-950/20 hover:bg-red-900/30 text-red-500 border border-red-500/20 transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
            title="Apagar TUDO (Votos, Candidatos e Eleitores)"
            aria-label="Limpar toda a base de dados"
          >
            <Trash2 className="w-5 h-5" />
            Limpar Tudo
          </button>

          <button
            onClick={() => setShowModal({
              show: true,
              type: 'clearVoters',
              title: 'Limpar Eleitores',
              message: 'ATENÇÃO: Deseja apagar permanentemente todos os eleitores cadastrados? Esta ação não pode ser desfeita e removerá todos os registros da base de dados.',
              action: handleClearVoters
            })}
            disabled={isResetting || isChecking}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
            aria-label="Limpar todos os eleitores"
          >
            <Users className="w-5 h-5" />
            Limpar Eleitores
          </button>

          <button
            onClick={toggleUrna}
            disabled={isResetting}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all focus-visible:ring-2 focus-visible:ring-white outline-none ${urnaStatus?.isOpen ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} disabled:opacity-50`}
            aria-label={urnaStatus?.isOpen ? 'Encerrar votação' : 'Abrir votação'}
          >
            {urnaStatus?.isOpen ? <PowerOff className="w-5 h-5" /> : <Power className="w-5 h-5" />}
            {urnaStatus?.isOpen ? 'Encerrar Votação' : 'Abrir Votação'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Candidates Section */}
        <div className="xl:col-span-2 space-y-8">
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-500" />
                Candidatos
              </h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => downloadTemplate('candidates')}
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg"
                  title="Baixar Template CSV"
                  aria-label="Baixar template CSV para candidatos"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => candidateFileRef.current?.click()}
                  className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg"
                  title="Importar CSV ou PDF"
                  aria-label="Importar candidatos via CSV ou PDF"
                >
                  <FileUp className="w-4 h-4" />
                </button>
                <input 
                  type="file" 
                  ref={candidateFileRef} 
                  onChange={handleImportCandidates} 
                  accept=".csv,.pdf" 
                  className="hidden" 
                />
              </div>
            </div>
            <div className="p-6">
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input
                  type="text"
                  placeholder="Buscar candidatos..."
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-6 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>

              <form onSubmit={handleAddCandidate} className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-8">
                <input
                  placeholder="Nome"
                  value={newCandidate.name}
                  onChange={e => setNewCandidate({...newCandidate, name: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="Nome do candidato"
                />
                <input
                  placeholder="Nº"
                  maxLength={2}
                  value={newCandidate.number}
                  onChange={e => setNewCandidate({...newCandidate, number: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="Número do candidato"
                />
                <input
                  placeholder="Partido"
                  value={newCandidate.party}
                  onChange={e => setNewCandidate({...newCandidate, party: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="Partido do candidato"
                />
                <div className="relative">
                  <input
                    type="file"
                    ref={photoInputRef}
                    onChange={e => setCandidatePhoto(e.target.files?.[0] || null)}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className={`w-full h-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-xs flex items-center gap-2 transition-colors ${candidatePhoto ? 'text-emerald-500 border-emerald-500/50' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    <ImagePlus className="w-4 h-4" />
                    {candidatePhoto ? 'Foto Selecionada' : 'Adicionar Foto'}
                  </button>
                </div>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AnimatePresence mode="popLayout">
                  {candidates
                    .filter(c => 
                      c.name.toLowerCase().includes(candidateSearch.toLowerCase()) || 
                      c.number.includes(candidateSearch) ||
                      c.party.toLowerCase().includes(candidateSearch.toLowerCase())
                    )
                    .map(c => (
                    <motion.div
                      key={c.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center gap-4 group focus-within:ring-2 focus-within:ring-emerald-500/50 transition-all"
                    >
                      <div className="w-12 h-12 bg-zinc-900 rounded-lg overflow-hidden flex items-center justify-center">
                        {c.photoUrl ? <img src={c.photoUrl} alt="" className="w-full h-full object-cover" /> : <Users className="w-6 h-6 text-zinc-700" />}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-sm">{c.name}</h3>
                        <p className="text-xs text-zinc-500">{c.number} - {c.party}</p>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await deleteDoc(doc(db, 'candidates', c.id));
                          } catch (error) {
                            handleFirestoreError(error, OperationType.DELETE, `candidates/${c.id}`);
                          }
                        }}
                        className="p-2 text-zinc-700 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 outline-none"
                        aria-label={`Excluir candidato ${c.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </section>

          {/* Voters Section */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-500" />
                Eleitores Permitidos
              </h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => downloadTemplate('voters')}
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg"
                  title="Baixar Template CSV"
                  aria-label="Baixar template CSV para eleitores"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => voterFileRef.current?.click()}
                  className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg"
                  title="Importar CSV ou PDF"
                  aria-label="Importar eleitores via CSV ou PDF"
                >
                  <FileUp className="w-4 h-4" />
                </button>
                <input 
                  type="file" 
                  ref={voterFileRef} 
                  onChange={handleImportVoters} 
                  accept=".csv,.pdf" 
                  className="hidden" 
                />
                <button onClick={exportVotersPDF} className="p-2 text-zinc-400 hover:text-red-400 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 outline-none rounded-lg" title="Exportar PDF (Lista de Chamada)" aria-label="Exportar lista de eleitores em PDF">
                  <FileText className="w-5 h-5" />
                </button>
                <button onClick={exportVotersTXT} className="p-2 text-zinc-400 hover:text-emerald-400 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg" title="Exportar TXT (Simples)" aria-label="Exportar lista de eleitores em TXT">
                  <Download className="w-5 h-5" />
                </button>
                <span className="text-xs text-zinc-500 uppercase tracking-widest self-center ml-2">{voters.length} Registrados</span>
              </div>
            </div>
            <div className="p-6">
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input
                  type="text"
                  placeholder="Buscar eleitores..."
                  value={voterSearch}
                  onChange={(e) => setVoterSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-6 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>

              <form onSubmit={handleAddVoter} className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
                <input
                  placeholder="RA"
                  value={newVoter.ra}
                  onChange={e => setNewVoter({...newVoter, ra: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="RA do eleitor"
                />
                <input
                  placeholder="Nome"
                  value={newVoter.name}
                  onChange={e => setNewVoter({...newVoter, name: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="Nome do eleitor"
                />
                <input
                  placeholder="Turma"
                  value={newVoter.class}
                  onChange={e => setNewVoter({...newVoter, class: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  aria-required="true"
                  aria-label="Turma do eleitor"
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </form>

              <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2 custom-scrollbar" role="list" aria-label="Lista de eleitores">
                <AnimatePresence mode="popLayout">
                  {voters
                    .filter(v => 
                      v.name.toLowerCase().includes(voterSearch.toLowerCase()) || 
                      v.ra.includes(voterSearch) ||
                      v.class.toLowerCase().includes(voterSearch.toLowerCase())
                    )
                    .map(v => (
                    <motion.div
                      key={v.id}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-lg flex items-center justify-between text-sm group focus-within:ring-2 focus-within:ring-emerald-500/50 transition-all"
                      role="listitem"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-emerald-500">{v.ra}</span>
                        <span className="font-medium">{v.name}</span>
                        <span className="text-zinc-600 text-xs">{v.class}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${v.voted ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                          {v.voted ? 'Votou' : 'Pendente'}
                        </span>
                        <button
                          onClick={async () => {
                            try {
                              await deleteDoc(doc(db, 'voters', v.id));
                            } catch (error) {
                              handleFirestoreError(error, OperationType.DELETE, `voters/${v.id}`);
                            }
                          }}
                          className="text-zinc-700 hover:text-red-500 transition-colors p-1"
                          aria-label={`Excluir eleitor ${v.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </section>
        </div>

        {/* Audit Logs Section */}
        <div className="space-y-8">
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-500" />
                <h2 className="text-xl font-bold">Log de Auditoria</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={exportLogsPDF} className="p-2 text-zinc-400 hover:text-red-400 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 outline-none rounded-lg" title="Exportar PDF" aria-label="Exportar logs de auditoria em PDF">
                  <FileText className="w-4 h-4" />
                </button>
                <button onClick={exportLogsCSV} className="p-2 text-zinc-400 hover:text-emerald-400 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none rounded-lg" title="Exportar CSV" aria-label="Exportar logs de auditoria em CSV">
                  <FileSpreadsheet className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-y-auto max-h-[800px] custom-scrollbar" aria-live="polite">
              <div className="space-y-6 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-zinc-800">
                <AnimatePresence initial={false}>
                  {logs.map(log => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="relative pl-8 overflow-hidden"
                    >
                      <div className="absolute left-0 top-1.5 w-5 h-5 bg-zinc-900 border-2 border-zinc-700 rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      </div>
                      <div className="text-xs font-mono text-zinc-500 mb-1">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="text-sm font-bold text-zinc-200">{log.event}</div>
                      <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{log.details}</div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="bg-red-500/10 p-3 rounded-2xl">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <button 
                  onClick={() => setShowModal(prev => ({ ...prev, show: false }))}
                  className="p-2 hover:bg-zinc-800 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-zinc-500" />
                </button>
              </div>

              <h3 className="text-2xl font-black text-white mb-4">{showModal.title}</h3>
              <p className="text-zinc-400 mb-8">{showModal.message}</p>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setShowModal(prev => ({ ...prev, show: false }))}
                  className="px-6 py-4 rounded-2xl font-bold bg-zinc-800 hover:bg-zinc-700 text-white transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={showModal.action}
                  className="px-6 py-4 rounded-2xl font-bold bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-600/20"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
