import React, { useState } from 'react';
import FileUploader from './components/FileUploader';
import ResultDisplay from './components/ResultDisplay';
import { parseExcelToGeoJson, generatePointsFromGeoJson } from './services/geoService';
import type { OutputFile } from './types';

// Type for Nominatim search results
interface SearchResult {
  osm_id: number;
  display_name: string;
  geojson: any; // GeoJSON geometry will be here for detailed lookups
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [regionName, setRegionName] = useState('');
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for the online search feature
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    // Auto-fill region name from filename, removing extension
    setRegionName(file.name.split('.').slice(0, -1).join('.'));
    setOutputFiles([]);
    setError(null);
    setSearchResults([]); // Clear search results when a file is uploaded
  };

  const handleSearch = async () => {
      if (!searchQuery.trim()) {
          setSearchError('Пожалуйста, введите название для поиска.');
          return;
      }
      setIsSearching(true);
      setSearchError(null);
      setSearchResults([]);
      setError(null);

      try {
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&polygon_geojson=1&limit=5`);
          if (!response.ok) {
              throw new Error('Сетевая ошибка при поиске.');
          }
          const data: SearchResult[] = await response.json();
          if (data.length === 0) {
              setSearchError('Ничего не найдено. Попробуйте другой запрос.');
          } else {
              // Only show results that have a valid geojson geometry
              const validResults = data.filter(item => item.geojson && (item.geojson.type === 'Polygon' || item.geojson.type === 'MultiPolygon'));
              if (validResults.length === 0) {
                 setSearchError('Не найдено результатов с подходящей геометрией (полигоном). Попробуйте более точный запрос.');
              } else {
                setSearchResults(validResults); 
              }
          }
      } catch (e) {
          setSearchError('Не удалось выполнить поиск. Проверьте соединение с интернетом.');
      } finally {
          setIsSearching(false);
      }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
      // FIX: Wrap the raw geometry from Nominatim into a proper GeoJSON Feature structure
      const geoJsonFeature = {
        type: "Feature",
        properties: {
          name: result.display_name
        },
        geometry: result.geojson
      };

      const geoJsonString = JSON.stringify(geoJsonFeature);
      const blob = new Blob([geoJsonString], { type: 'application/json' });
      const sanitizedName = result.display_name.split(',')[0].replace(/[^a-z0-9\s-]/gi, '').trim();
      const file = new File([blob], `${sanitizedName}.geojson`, { type: 'application/json' });

      setSelectedFile(file);
      setRegionName(result.display_name.split(',')[0]); // Use the primary name
      setSearchResults([]); // Hide results after selection
      setSearchQuery(''); // Clear search input
      setError(null);
      setOutputFiles([]);
  };

  const handleGenerateClick = async () => {
    if (!selectedFile || !regionName.trim()) {
      setError('Пожалуйста, выберите файл и укажите название региона.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setOutputFiles([]);

    try {
      let geoJsonString: string;
      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();

      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        geoJsonString = await parseExcelToGeoJson(selectedFile);
      } else if (fileExtension === 'geojson' || fileExtension === 'json') {
        geoJsonString = await selectedFile.text();
      } else {
        throw new Error('Неподдерживаемый тип файла. Пожалуйста, выберите .xlsx, .xls, .geojson, или .json файл.');
      }
      
      const generatedFiles = await generatePointsFromGeoJson(geoJsonString, regionName);
      
      if(generatedFiles.length === 0) {
        setError('Не удалось сгенерировать точки. Возможно, указанный регион слишком мал или имеет неподходящую форму для внутреннего отступа в 10 км.');
      } else {
        setOutputFiles(generatedFiles);
      }

    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Произошла неизвестная ошибка.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center p-4 sm:p-8 font-sans">
      <div className="w-full max-w-2xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-4xl font-bold text-indigo-400">Генератор Точек для Геозон</h1>
          <p className="mt-2 text-lg text-gray-400">
            Найдите регион онлайн или загрузите свой файл с полигоном (.xlsx, .geojson).
          </p>
        </header>
        
        {/* --- Online Search Section --- */}
        <section className="p-8 bg-gray-800/50 border border-gray-700 rounded-xl shadow-2xl space-y-4">
            <h2 className="text-lg font-semibold text-gray-300">1. Найти регион онлайн (рекомендуется)</h2>
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Например, Сахалинская область"
                  className="flex-grow bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
                <button onClick={handleSearch} disabled={isSearching} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition duration-300 flex items-center justify-center">
                  {isSearching && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>}
                  Найти
                </button>
            </div>
            {searchError && <p className="text-sm text-red-400">{searchError}</p>}
            {searchResults.length > 0 && (
                <div className="space-y-2 pt-2">
                    <h3 className="text-md font-semibold text-gray-400">Результаты поиска:</h3>
                    {searchResults.map(result => (
                        <div key={result.osm_id} className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
                            <span className="text-sm text-gray-300 truncate pr-2">{result.display_name}</span>
                            <button onClick={() => handleSelectSearchResult(result)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded-lg transition text-sm flex-shrink-0">
                                Использовать
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>

        <div className="flex items-center text-center">
          <div className="flex-grow border-t border-gray-700"></div>
          <span className="flex-shrink mx-4 text-gray-500 font-semibold">ИЛИ</span>
          <div className="flex-grow border-t border-gray-700"></div>
        </div>

        {/* --- Manual Upload Section --- */}
        <main className="p-8 bg-gray-800/50 border border-gray-700 rounded-xl shadow-2xl space-y-6">
           <h2 className="text-lg font-semibold text-gray-300">2. Загрузить свой файл</h2>
          <div className="space-y-2">
            <label htmlFor="region-name" className="block text-sm font-medium text-gray-300">
              Название Региона
            </label>
            <input
              id="region-name"
              type="text"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
              placeholder="Например, Moscow_Oblast"
              disabled={isLoading}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition disabled:opacity-50"
            />
             <p className="text-xs text-gray-500">Это название будет использовано в именах файлов и внутри них.</p>
          </div>
          
          <div className="space-y-2">
             <label className="block text-sm font-medium text-gray-300">
              Файл с Полигоном
            </label>
            <FileUploader onFileSelect={handleFileSelect} disabled={isLoading} />
             {selectedFile && (
              <p className="text-sm text-center text-gray-400 mt-2">
                Выбран файл: <span className="font-medium text-indigo-400">{selectedFile.name}</span>
              </p>
            )}
            <p className="text-xs text-gray-500 text-center">Поддерживаемые форматы: .xlsx, .xls, .geojson, .json</p>
          </div>
          
          <button
            onClick={handleGenerateClick}
            disabled={isLoading || !selectedFile || !regionName.trim()}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 flex items-center justify-center space-x-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Генерация...</span>
              </>
            ) : (
             <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="http://www.w3.org/2000/svg" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M12 8h.01M15 8h.01M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
              </svg>
              <span>Сгенерировать Точки</span>
             </>
            )}
          </button>
        </main>

        <ResultDisplay outputFiles={outputFiles} isLoading={isLoading} error={error} />
      </div>
       <footer className="mt-12 text-center text-gray-500 text-sm">
          <p>&copy; {new Date().getFullYear()} GeoPoint Generator. Все права защищены.</p>
       </footer>
    </div>
  );
}

export default App;