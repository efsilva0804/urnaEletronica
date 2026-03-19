import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Candidate, Voter, Vote } from '../types';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download, FileJson, FileText, Users, UserCheck, UserX, Hash } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { motion } from 'motion/react';

export function ResultsDashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);

  useEffect(() => {
    const unsubCandidates = onSnapshot(collection(db, 'candidates'), (snap) => {
      setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Candidate)));
    });
    const unsubVoters = onSnapshot(collection(db, 'voters'), (snap) => {
      setVoters(snap.docs.map(d => ({ id: d.id, ...d.data() } as Voter)));
    });
    const unsubVotes = onSnapshot(collection(db, 'votes'), (snap) => {
      setVotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vote)));
    });

    return () => {
      unsubCandidates();
      unsubVoters();
      unsubVotes();
    };
  }, []);

  const totalVoters = voters.length;
  const totalVotes = votes.length;
  const votedCount = voters.filter(v => v.voted).length;
  const abstentionCount = totalVoters - votedCount;

  const blankVotes = votes.filter(v => v.candidateId === 'BLANK').length;
  const nullVotes = votes.filter(v => v.candidateId === 'NULL').length;
  const validVotes = votes.filter(v => v.candidateId !== 'BLANK' && v.candidateId !== 'NULL').length;

  const chartData = [
    ...candidates.map(c => ({ name: c.name, value: c.votesCount || 0, color: '#10b981' })),
    { name: 'Brancos', value: blankVotes, color: '#71717a' },
    { name: 'Nulos', value: nullVotes, color: '#ef4444' }
  ].filter(d => d.value > 0);

  const exportJSON = () => {
    const data = {
      eleicao: "Urna Eletrônica Escolar Auditável",
      data_emissao: new Date().toISOString(),
      resumo: {
        total_eleitores: totalVoters,
        total_votos: totalVotes,
        abstencao: abstentionCount,
        brancos: blankVotes,
        nulos: nullVotes,
        validos: validVotes
      },
      candidatos: candidates.map(c => ({
        nome: c.name,
        numero: c.number,
        votos: c.votesCount || 0
      })),
      boletim_urna: votes.map(v => ({
        hash: v.hash,
        timestamp: v.timestamp,
        previousHash: v.previousHash
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boletim_urna_${new Date().getTime()}.json`;
    a.click();
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('Boletim de Urna - Eleição Escolar', 20, 20);
    
    doc.setFontSize(12);
    doc.text(`Data: ${new Date().toLocaleString()}`, 20, 30);
    doc.text(`Total de Eleitores: ${totalVoters}`, 20, 40);
    doc.text(`Total de Votos: ${totalVotes}`, 20, 50);
    doc.text(`Abstenção: ${abstentionCount}`, 20, 60);

    doc.text('Resultados:', 20, 80);
    let y = 90;
    candidates.forEach(c => {
      doc.text(`${c.name} (${c.number}): ${c.votesCount || 0} votos`, 30, y);
      y += 10;
    });
    doc.text(`Brancos: ${blankVotes}`, 30, y);
    doc.text(`Nulos: ${nullVotes}`, 30, y + 10);

    doc.text('Cadeia de Auditoria (Hashes):', 20, y + 30);
    y += 40;
    votes.slice(-10).forEach(v => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(8);
      doc.text(`Hash: ${v.hash}`, 20, y);
      y += 5;
    });

    doc.save(`boletim_urna_${new Date().getTime()}.pdf`);
  };

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Eleitores" value={totalVoters} icon={<Users className="w-5 h-5 text-zinc-400" />} />
        <StatCard title="Votos Computados" value={totalVotes} icon={<UserCheck className="w-5 h-5 text-emerald-500" />} />
        <StatCard title="Abstenção" value={abstentionCount} icon={<UserX className="w-5 h-5 text-red-500" />} />
        <StatCard title="Votos Válidos" value={validVotes} icon={<Hash className="w-5 h-5 text-emerald-500" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Chart Section */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-8 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-emerald-500" />
            Distribuição de Votos
          </h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bar Chart Section */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-8 flex items-center gap-2">
            <BarChart className="w-5 h-5 text-emerald-500" />
            Votos por Candidato
          </h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  cursor={{ fill: '#27272a' }}
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Reports Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500" />
              Relatório de Abstenção
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
            {voters.filter(v => !v.voted).map(v => (
              <div key={v.id} className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-bold">{v.name}</span>
                  <span className="text-xs text-zinc-500">{v.ra} - {v.class}</span>
                </div>
                <span className="text-[10px] uppercase font-black text-red-500/50">AUSENTE</span>
              </div>
            ))}
            {abstentionCount === 0 && (
              <div className="col-span-full py-12 text-center text-zinc-500 italic">
                Nenhuma abstenção registrada. Quórum de 100%.
              </div>
            )}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-center gap-4">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Download className="w-5 h-5 text-emerald-500" />
            Exportar Dados
          </h2>
          <p className="text-sm text-zinc-500 mb-4">Gere os documentos oficiais de auditoria e o Boletim de Urna digital.</p>
          
          <button
            onClick={exportPDF}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3 border border-zinc-700"
          >
            <FileText className="w-5 h-5 text-red-400" />
            Gerar PDF (Boletim)
          </button>
          
          <button
            onClick={exportJSON}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3 border border-zinc-700"
          >
            <FileJson className="w-5 h-5 text-emerald-400" />
            Exportar JSON (Audit)
          </button>
        </section>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
      <div className="flex justify-between items-start mb-4">
        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{title}</span>
        {icon}
      </div>
      <div className="text-3xl font-black text-white">{value}</div>
    </div>
  );
}
