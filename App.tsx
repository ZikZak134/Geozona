import React, { useState } from 'react';
import FileUploader from './components/FileUploader';
import ResultDisplay from './components/ResultDisplay';
import { parseExcelToGeoJson, generatePointsFromGeoJson } from './services/geoService';
import type { OutputFile } from './types';

interface SearchResult {
  display_name: string;
  geojson: any;
}

function App() {
  const [regionName, setRegionName] = useState('');
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);


  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    if (!regionName) {
      // Auto-fill region name from filename, removing extension
      setRegionName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setError(null);
    setSearchResults([]);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&polygon_geojson=1`);
      if (!response.ok) {
        throw new Error('Сетевой ответ от сервиса поиска был не в порядке.');
      }
      const data = await response.json();
      setSearchResults(data.filter((item: any) => item.geojson && (item.geojson.type === 'Polygon' || item.geojson.type === 'MultiPolygon')));
    } catch (err) {
      setError('Не удалось выполнить поиск. Проверьте ваше интернет-соединение.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
    const geoJsonString = JSON.stringify(result.geojson);
    const blob = new Blob([geoJsonString], { type: 'application/json' });
    const file = new File([blob], `${result.display_name.split(',')[0]}.geojson`, { type: 'application/json' });

    setSelectedFile(file);
    setRegionName(result.display_name.split(',')[0]);
    setSearchResults([]);
    setSearchQuery('');
  };

  const handleGenerate = async () => {
    if (!selectedFile || !regionName.trim()) {
      setError('Пожалуйста, укажите название региона и выберите файл с полигоном.');
      return;
    }
    
    if (radiusKm < 0.5) {
      setError('Радиус должен быть не менее 0.5 км.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setOutputFiles([]);

    try {
      let geoJsonString: string;
      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();

      if (['xlsx', 'xls'].includes(fileExtension!)) {
        geoJsonString = await parseExcelToGeoJson(selectedFile);
      } else {
        geoJsonString = await selectedFile.text();
      }
      
      const result = await generatePointsFromGeoJson(geoJsonString, regionName, radiusKm);
      setOutputFiles(result);

    } catch (err: unknown) {
      let errorMessage = 'Произошла неизвестная ошибка.';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const isGenerateDisabled = isLoading || !selectedFile || !regionName.trim() || radiusKm < 0.5;

  return (
    <div className="text-gray-200 min-h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-2xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-100">
            Генератор Гео-Точек
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Найдите регион онлайн или загрузите свой файл, чтобы сгенерировать точки покрытия.
          </p>
        </header>

        <main className="w-full space-y-6">
          {/* --- Online Search Section --- */}
          <div className="bg-slate-800 border border-slate-700 p-6 rounded-xl shadow-lg">
            <h2 className="text-xl font-semibold mb-4 text-gray-100">1. Найти регион онлайн (рекомендуется)</h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Область, город, район или село..."
                className="flex-grow bg-slate-900 text-white border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300"
              />
              <button onClick={handleSearch} disabled={isSearching} className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors duration-300">
                {isSearching ? 'Поиск...' : 'Найти'}
              </button>
            </div>
             <p className="text-xs text-slate-500 mt-2">Например: "Сахалинская область", "город Суздаль", "район Хамовники Москва"</p>
            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2 max-h-60 overflow-y-auto pr-2">
                {searchResults.map((result, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-md hover:bg-slate-700 transition-colors duration-300">
                    <span className="text-sm text-gray-300">{result.display_name}</span>
                    <button onClick={() => handleSelectSearchResult(result)} className="bg-sky-600 hover:bg-sky-500 text-white font-bold py-1 px-3 rounded text-sm transition-colors duration-300 flex-shrink-0">Использовать</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative text-center">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-700"></div>
              </div>
              <div className="relative flex justify-center">
                  <span className="bg-slate-900 px-3 text-slate-500 font-medium">ИЛИ</span>
              </div>
          </div>

          {/* --- Manual Upload Section --- */}
          <div className="bg-slate-800 border border-slate-700 p-6 rounded-xl shadow-lg">
             <h2 className="text-xl font-semibold mb-4 text-gray-100">2. Загрузить свой файл</h2>
             <div className="space-y-6">
                <div>
                    <label htmlFor="regionName" className="block text-sm font-medium text-slate-300 mb-2">Название Региона</label>
                    <input
                        id="regionName"
                        type="text"
                        value={regionName}
                        onChange={(e) => setRegionName(e.target.value)}
                        className="w-full bg-slate-900 text-white border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300"
                        placeholder="Например, Амурская область"
                    />
                    <p className="text-xs text-slate-500 mt-1">Это название будет использовано в именах файлов и внутри них.</p>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Файл с Полигоном</label>
                    <FileUploader onFileSelect={handleFileSelect} disabled={isLoading} />
                    {selectedFile && <p className="text-sm text-green-400 mt-2 text-center">Выбран файл: {selectedFile.name}</p>}
                    <p className="text-xs text-slate-500 mt-1 text-center">Поддерживаемые форматы: .xlsx, .xls, .geojson, .json</p>
                </div>
                <div>
                    <label htmlFor="radius" className="block text-sm font-medium text-slate-300 mb-2">Радиус точки и отступ от границы (км)</label>
                    <input
                        id="radius"
                        type="number"
                        value={radiusKm}
                        onChange={(e) => setRadiusKm(Math.max(0.5, parseFloat(e.target.value) || 0))}
                        step="0.1"
                        min="0.5"
                        className="w-full bg-slate-900 text-white border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300"
                    />
                </div>
                
                <button onClick={handleGenerate} disabled={isGenerateDisabled} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                     <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                   </svg>
                   <span>Сгенерировать Точки</span>
                </button>
             </div>
          </div>

          {/* --- Results --- */}
          {(isLoading || error || outputFiles.length > 0) && (
            <ResultDisplay
              outputFiles={outputFiles}
              isLoading={isLoading}
              error={error}
            />
          )}
        </main>
        
        <footer className="text-center text-slate-500 text-sm pt-4">
            <p>&copy; {new Date().getFullYear()} GeoPoint Generator. Все права защищены.</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
