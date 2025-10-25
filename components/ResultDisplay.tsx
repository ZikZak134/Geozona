import React from 'react';
import type { OutputFile } from '../types';

interface ResultDisplayProps {
  outputFiles: OutputFile[];
  isLoading: boolean;
  error: string | null;
  progress: number;
  totalFiles: number | null;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ outputFiles, isLoading, error, progress, totalFiles }) => {

  const handleDownload = (file: OutputFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const ProgressDisplay = () => (
    <div className="w-full p-6 bg-slate-800 border border-slate-700 rounded-xl">
      <h3 className="text-lg text-slate-300 font-semibold text-center mb-4">Генерация точек...</h3>
      <div className="w-full bg-slate-700 rounded-full h-4 overflow-hidden">
        <div 
          className="bg-blue-500 h-4 rounded-full transition-all duration-300 ease-linear" 
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        ></div>
      </div>
      <p className="text-center text-slate-400 mt-3 text-sm font-medium">
        {Math.round(progress)}%
      </p>
      {totalFiles !== null && (
         <p className="text-center text-slate-400 mt-1 text-sm">
            {`Сгенерировано ${outputFiles.length} из ~${totalFiles} файлов`}
         </p>
      )}
    </div>
  );

  if (error) {
    return (
      <div className="w-full p-6 bg-red-900/20 border border-red-500/50 rounded-xl">
        <p className="text-red-400 font-semibold text-center text-lg">Ошибка</p>
        <p className="text-red-400 mt-2 text-center">{error}</p>
      </div>
    );
  }

  if (isLoading && outputFiles.length === 0) {
    return <ProgressDisplay />;
  }

  if (outputFiles.length === 0 && !isLoading) {
    return null; // Don't show anything if there are no files (initial state)
  }

  return (
    <div className="w-full p-6 bg-slate-800 border border-slate-700 rounded-xl space-y-4">
      {isLoading && <ProgressDisplay />}
      <div>
        <h3 className="text-xl font-semibold text-gray-100">
            {isLoading ? 'Промежуточные результаты' : 'Сгенерированные файлы'}
        </h3>
        <div className="space-y-3 mt-4">
            {outputFiles.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-md hover:bg-slate-700 transition-colors duration-300">
                <div className="flex items-center space-x-3 overflow-hidden">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                <span className="font-mono text-gray-300 truncate">{file.name}</span>
                </div>
                <button
                onClick={() => handleDownload(file)}
                className="bg-sky-600 hover:bg-sky-500 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-300 text-sm flex items-center space-x-2 flex-shrink-0"
                >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Скачать</span>
                </button>
            </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ResultDisplay;
