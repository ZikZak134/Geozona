// Add this line to inform TypeScript about the global turf object from the CDN
declare const turf: any;
// Add this line for the SheetJS library
declare const XLSX: any;

import type { OutputFile } from '../types';

const RADIUS_KM = 10;
const GRID_STEP_KM = 14; // Use a grid step of sqrt(2) * 10km to ensure coverage with circles
const POINTS_PER_FILE = 200;


export const parseExcelToGeoJson = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // Convert sheet to array of arrays
        const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonRows.length < 3) {
            reject(new Error('Excel-файл должен содержать как минимум 3 точки для создания полигона.'));
            return;
        }

        // Convert to [lon, lat] for GeoJSON
        const points = jsonRows
            .map(row => {
              // Skip empty or invalid rows
              if (!row || row.length === 0 || row[0] === null || row[0] === undefined) {
                  return null;
              }

              // Handle case: lat,lon are in a single column (A) separated by a comma
              if (typeof row[0] === 'string' && row[0].includes(',')) {
                const parts = row[0].replace(/\s/g, '').split(',');
                if (parts.length === 2) {
                  const lat = parseFloat(parts[0]);
                  const lon = parseFloat(parts[1]);
                  return turf.point([lon, lat]); // GeoJSON format is [longitude, latitude]
                }
              }
              // Handle case: lat is in column A and lon is in column B
              else if (row.length >= 2) {
                const lat = parseFloat(row[0]);
                const lon = parseFloat(row[1]);
                return turf.point([lon, lat]); // GeoJSON format is [longitude, latitude]
              }
              return null; // Return null if format is wrong
            })
            .filter(point => point !== null && !isNaN(point.geometry.coordinates[0]) && !isNaN(point.geometry.coordinates[1]));


        if (points.length < 3) {
            reject(new Error('Не удалось извлечь валидные координаты. Убедитесь, что файл отформатирован правильно: либо широта и долгота в отдельных колонках (A и B), либо в одной колонке (A) через запятую.'));
            return;
        }
        
        // NEW: Create a convex hull from the points. This is the "smart" way.
        // It creates a proper polygon boundary from an unordered set of points.
        const featureCollection = turf.featureCollection(points);
        const convexHull = turf.convex(featureCollection);

        if (!convexHull) {
           reject(new Error('Не удалось построить полигон (выпуклую оболочку) из предоставленных точек.'));
           return;
        }

        resolve(JSON.stringify(convexHull));
      } catch (e) {
        reject(new Error('Не удалось прочитать или обработать Excel-файл. Пожалуйста, проверьте формат файла.'));
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsArrayBuffer(file);
  });
};


export const generatePointsFromGeoJson = async (
  geoJsonString: string,
  regionName: string
): Promise<OutputFile[]> => {
  return new Promise((resolve, reject) => {
    try {
      if (!regionName.trim()) {
        throw new Error('Название региона не может быть пустым.');
      }

      const geoJson = JSON.parse(geoJsonString);

      // Find the first Polygon or MultiPolygon feature
      let mainPolygon: any;
      // If the input is a single Feature, use it. Otherwise, search within a FeatureCollection.
      if (geoJson.type === 'Feature' && geoJson.geometry && (geoJson.geometry.type === 'Polygon' || geoJson.geometry.type === 'MultiPolygon')) {
        mainPolygon = geoJson;
      } else if (geoJson.type === 'FeatureCollection') {
        turf.featureEach(geoJson, (feature: any) => {
            if (!mainPolygon && feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
                mainPolygon = feature;
            }
        });
      }

      if (!mainPolygon) {
        throw new Error('В предоставленных данных не найдена геометрия типа "Полигон" или "Мультиполигон".');
      }

      // 1. Create an inner buffer of the polygon
      const bufferedPolygon = turf.buffer(mainPolygon, -RADIUS_KM, { units: 'kilometers' });

      if (!bufferedPolygon || !bufferedPolygon.geometry || bufferedPolygon.geometry.coordinates.length === 0) {
        resolve([]); // Return empty if buffer is invalid (region too small)
        return;
      }
      
      // 2. Get the bounding box of the buffered area
      const bbox = turf.bbox(bufferedPolygon);
      const [minLng, minLat, maxLng, maxLat] = bbox;

      const validPoints: [number, number][] = [];

      // 3. Iterate over the bounding box to create a grid
      let currentLat = minLat;
      while (currentLat <= maxLat) {
        let currentLng = minLng;
        while (currentLng <= maxLng) {
          const point = turf.point([currentLng, currentLat]);

          // 4. Check if the grid point is inside the buffered polygon
          if (turf.booleanPointInPolygon(point, bufferedPolygon)) {
            validPoints.push([currentLat, currentLng]);
          }

          // Move to the next longitude point
          const nextLngPoint = turf.destination(point, GRID_STEP_KM, 90, { units: 'kilometers' });
          currentLng = nextLngPoint.geometry.coordinates[0];
        }
        
        // Move to the next latitude point
        const nextLatPoint = turf.destination(turf.point([minLng, currentLat]), GRID_STEP_KM, 0, { units: 'kilometers' });
        currentLat = nextLatPoint.geometry.coordinates[1];
      }

      // 5. Format points into strings with 6 decimal places for precision
      const formattedLines = validPoints.map(p => {
        const [lat, lng] = p;
        return `${regionName}:10km:${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      });

      // 6. Chunk the formatted lines into files
      const outputFiles: OutputFile[] = [];
      for (let i = 0; i < formattedLines.length; i += POINTS_PER_FILE) {
        const chunk = formattedLines.slice(i, i + POINTS_PER_FILE);
        const fileContent = chunk.join('\n');
        const partNumber = Math.floor(i / POINTS_PER_FILE) + 1;
        outputFiles.push({
          name: `${regionName}_part${partNumber}.txt`,
          content: fileContent,
        });
      }
      
      resolve(outputFiles);

    } catch (error) {
      if (error instanceof Error) {
        reject(new Error(`Ошибка обработки: ${error.message}`));
      } else {
        reject(new Error('Во время обработки произошла неизвестная ошибка.'));
      }
    }
  });
};