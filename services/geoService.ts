// services/geoService.ts
import type { OutputFile } from '../types';

// Declare turf and XLSX to satisfy TypeScript, as they are loaded from a CDN.
declare const turf: any;
declare const XLSX: any;

const CHUNK_SIZE = 200;

/**
 * Parses an Excel file (.xlsx, .xls) containing coordinates into a GeoJSON Polygon string.
 * It automatically creates a convex hull around the points.
 * Supports two formats:
 * 1. A single column with "latitude,longitude".
 * 2. Two separate columns for latitude and longitude.
 * @param file The Excel file to parse.
 * @returns A promise that resolves with a GeoJSON Feature string.
 */
export const parseExcelToGeoJson = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: (string | number)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const coordinates: number[][] = [];
        for (const row of json) {
          if (!row || row.length === 0) continue;

          let lat: number | undefined, lon: number | undefined;

          // Case 1: Single column with "lat,lon"
          if (typeof row[0] === 'string' && row[0].includes(',')) {
            const parts = row[0].split(',').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              lat = parts[0];
              lon = parts[1];
            }
          } 
          // Case 2: Two separate columns
          else if (row.length >= 2) {
             const val1 = parseFloat(String(row[0]));
             const val2 = parseFloat(String(row[1]));
             if (!isNaN(val1) && !isNaN(val2)) {
                lat = val1;
                lon = val2;
             }
          }

          if (typeof lat === 'number' && typeof lon === 'number') {
            // Standard GeoJSON format is [longitude, latitude]
            coordinates.push([lon, lat]);
          }
        }

        if (coordinates.length < 3) {
          reject(new Error('Не удалось найти достаточно валидных координат (требуется минимум 3) для построения полигона.'));
          return;
        }

        const points = turf.featureCollection(
            coordinates.map(coord => turf.point(coord))
        );
        
        // Create a convex hull polygon containing all points
        const convexHull = turf.convex(points);
        if (!convexHull) {
            reject(new Error('Не удалось создать полигон (выпуклую оболочку) из предоставленных точек.'));
            return;
        }

        resolve(JSON.stringify(convexHull));
      } catch (error) {
        reject(new Error('Не удалось обработать Excel-файл. Убедитесь, что он имеет правильный формат.'));
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsArrayBuffer(file);
  });
};


/**
 * Generates formatted coordinate points within a given GeoJSON polygon.
 * @param geoJsonString The GeoJSON data as a string.
 * @param regionName The name of the region for labeling.
 * @param radiusKm The radius for points and the buffer from the border.
 * @returns A promise that resolves with an array of output files.
 */
export const generatePointsFromGeoJson = async (
    geoJsonString: string, 
    regionName: string, 
    radiusKm: number
): Promise<OutputFile[]> => {
    const geoJson = JSON.parse(geoJsonString);

    // Find the first polygon or multipolygon feature
    let feature;
    if (geoJson.type === 'FeatureCollection') {
        feature = geoJson.features.find((f: any) => 
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
    } else if (geoJson.type === 'Feature' && geoJson.geometry && (geoJson.geometry.type === 'Polygon' || geoJson.geometry.type === 'MultiPolygon')) {
        feature = geoJson;
    } else if (geoJson.type === 'Polygon' || geoJson.type === 'MultiPolygon') {
        feature = turf.feature(geoJson);
    }

    if (!feature) {
        throw new Error('В предоставленных данных не найдена геометрия типа "Полигон" или "Мультиполигон".');
    }

    // Create a negative buffer to work inside the boundary
    const buffered = turf.buffer(feature, -radiusKm, { units: 'kilometers' });
    if (!buffered || buffered.geometry.coordinates.length === 0) {
        throw new Error(`Не удалось сгенерировать точки. Возможно, указанный регион слишком мал или имеет неподходящую форму для внутреннего отступа в ${radiusKm} км.`);
    }

    // Use a step that ensures full coverage (diagonal of a square with side = radius * 2)
    // A simpler grid step is often sufficient and faster. We use radius * sqrt(2).
    const gridStep = radiusKm * Math.sqrt(2);
    const bbox = turf.bbox(buffered);
    const grid = turf.pointGrid(bbox, gridStep, { units: 'kilometers' });

    // Filter points to be strictly within the buffered zone
    const pointsWithin = turf.pointsWithinPolygon(grid, buffered);

    if (pointsWithin.features.length === 0) {
        throw new Error(`Не удалось сгенерировать ни одной точки внутри указанной зоны с отступом в ${radiusKm} км.`);
    }

    // Format points for output
    const formattedLines = pointsWithin.features.map((f: any) => {
        const coord = f.geometry.coordinates;
        return `${regionName}:${radiusKm}km:${coord[1].toFixed(6)},${coord[0].toFixed(6)}`; // lat,lon
    });

    // Chunk into files
    const outputFiles: OutputFile[] = [];
    for (let i = 0; i < formattedLines.length; i += CHUNK_SIZE) {
        const chunk = formattedLines.slice(i, i + CHUNK_SIZE);
        const fileNumber = Math.floor(i / CHUNK_SIZE) + 1;
        outputFiles.push({
            name: `${regionName}_part${fileNumber}.txt`,
            content: chunk.join('\n'),
        });
    }

    return outputFiles;
};