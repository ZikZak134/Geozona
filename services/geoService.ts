import type { OutputFile } from '../types';

// Declare turf and XLSX as globals since they are loaded from script tags in index.html
declare const turf: any;
declare const XLSX: any;

/**
 * Parses an Excel file containing polygon coordinates into a GeoJSON string
 * using a client-side algorithm (SheetJS + Turf.js).
 * @param file The Excel file (.xlsx or .xls).
 * @returns A promise that resolves to a GeoJSON string of a Polygon Feature.
 */
export async function parseExcelToGeoJson(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonArray: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  const points: any[] = [];
  const latKeys = ['lat', 'latitude', 'широта'];
  const lonKeys = ['lon', 'lng', 'longitude', 'долгота'];

  let latIndex = -1;
  let lonIndex = -1;

  // Find header indices if they exist
  const header = jsonArray[0] as string[];
  if (header && header.length > 0) {
      header.forEach((h, i) => {
          const lowerH = h.toString().toLowerCase();
          if (latKeys.includes(lowerH)) latIndex = i;
          if (lonKeys.includes(lowerH)) lonIndex = i;
      });
  }


  for (const row of jsonArray) {
    // Skip empty rows
    if (!row || row.length === 0) continue;
    
    let lat: number | null = null;
    let lon: number | null = null;

    if (latIndex !== -1 && lonIndex !== -1) {
        // Parse using header indices
        lat = parseFloat(String(row[latIndex]).replace(',', '.'));
        lon = parseFloat(String(row[lonIndex]).replace(',', '.'));
    } else {
        // Fallback: try to parse from first two columns or a single comma-separated column
        const firstCol = String(row[0]);
        if (firstCol.includes(',')) {
            const parts = firstCol.split(',').map(p => parseFloat(p.trim().replace(',', '.')));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                // Assuming lat, lon
                lat = parts[0];
                lon = parts[1];
            }
        } else if (row.length >= 2) {
             // Assuming first column is lat, second is lon
             lat = parseFloat(firstCol.replace(',', '.'));
             lon = parseFloat(String(row[1]).replace(',', '.'));
        }
    }
    
    if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
        // GeoJSON uses [longitude, latitude]
        points.push(turf.point([lon, lat]));
    }
  }

  if (points.length < 3) {
    throw new Error('В Excel-файле не найдено достаточного количества валидных координат (требуется минимум 3 точки) для построения полигона.');
  }

  const featureCollection = turf.featureCollection(points);
  const convexPolygon = turf.convex(featureCollection);

  if (!convexPolygon || convexPolygon.geometry.type !== 'Polygon') {
     throw new Error('Не удалось построить полигон из предоставленных точек. Убедитесь, что точки образуют валидную область.');
  }

  // The generatePointsFromGeoJson function can handle a Feature, so this is fine.
  return JSON.stringify(convexPolygon);
}

// Define the types for the yielded results from the generator
type GenerationResult = 
  | { type: 'progress'; value: number }
  | { type: 'totalFiles'; value: number }
  | { type: 'file'; value: OutputFile };

/**
 * Generates coverage points within a given GeoJSON polygon and yields progress
 * and generated files in real-time.
 * @param geoJsonString The GeoJSON of the polygon.
 * @param regionName The name of the region for context.
 * @param radiusKm The radius for point coverage and boundary offset.
 * @returns An async generator that yields progress updates and OutputFile objects.
 */
export async function* generatePointsFromGeoJson(
  geoJsonString: string,
  regionName: string,
  radiusKm: number
): AsyncGenerator<GenerationResult> {
  try {
    const geoJson = JSON.parse(geoJsonString);
    
    let geometry;
    if (geoJson.type === 'Feature') {
        geometry = geoJson.geometry;
    } else if (geoJson.type === 'Polygon' || geoJson.type === 'MultiPolygon') {
        geometry = geoJson;
    } else if (geoJson.type === 'FeatureCollection' && geoJson.features.length > 0) {
        const polyFeature = geoJson.features.find((f: any) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
        if (polyFeature) geometry = polyFeature.geometry;
    }

    if (!geometry) {
        throw new Error('В предоставленных данных не найдена геометрия типа "Полигон" или "Мультиполигон".');
    }
    
    const bufferedPolygon = turf.buffer(geometry, -radiusKm, { units: 'kilometers' });

    if (!bufferedPolygon || !bufferedPolygon.geometry || bufferedPolygon.geometry.coordinates.length === 0 || bufferedPolygon.geometry.coordinates[0].length === 0) {
      throw new Error(`Не удалось сгенерировать точки. Возможно, указанный регион слишком мал или имеет неподходящую форму для внутреннего отступа в ${radiusKm} км.`);
    }

    const bbox = turf.bbox(bufferedPolygon);
    const hexGrid = turf.hexGrid(bbox, radiusKm, { units: 'kilometers' });
    const totalHexagons = hexGrid.features.length;

    const points: { latitude: number; longitude: number; }[] = [];
    let processedCount = 0;

    for (const cell of hexGrid.features) {
      const center = turf.centroid(cell);
      if (turf.booleanPointInPolygon(center, bufferedPolygon)) {
        const [longitude, latitude] = center.geometry.coordinates;
        points.push({ latitude, longitude });
      }
      processedCount++;
      if (processedCount % 100 === 0 || processedCount === totalHexagons) {
         await new Promise(resolve => setTimeout(resolve, 0)); // Allow UI to update
         yield { type: 'progress', value: (processedCount / totalHexagons) * 100 };
      }
    }

    if (points.length === 0) {
       throw new Error(`Не удалось сгенерировать точки. Внутри созданной буферной зоны (${radiusKm} км) не поместилось ни одного центра точки.`);
    }

    const slugify = (text: string) => {
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    };
    const regionSlug = slugify(regionName);
    const lines = points.map(p => `${regionSlug}:${radiusKm}km:${p.latitude}, ${p.longitude}`);
    
    const pointsPerFile = 200;
    const totalFiles = Math.ceil(lines.length / pointsPerFile);
    yield { type: 'totalFiles', value: totalFiles };

    for (let i = 0; i < lines.length; i += pointsPerFile) {
        const chunk = lines.slice(i, i + pointsPerFile);
        const fileNumber = (i / pointsPerFile) + 1;
        const outputFile: OutputFile = {
            name: `${regionSlug}_part${fileNumber}.txt`,
            content: chunk.join('\n'),
        };
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate work and allow UI to update
        yield { type: 'file', value: outputFile };
    }

  } catch (e: any) {
    console.error("Error during point generation:", e);
    if (e.message.startsWith('Не удалось')) {
        throw e;
    }
    throw new Error('Произошла ошибка при обработке геометрии. Убедитесь, что файл содержит корректный полигон.');
  }
}
