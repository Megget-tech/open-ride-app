/**
 * Generates a Garmin TCX (Training Center XML) file from workout trackpoints.
 * TCX is accepted by Strava and most training platforms.
 *
 * Supports: power (via ActivityExtension/v2), heart rate, cadence.
 */

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a TCX XML string from per-second trackpoints + summary stats.
 *
 * @param {Array<{time:string, power:number, hr:number, cadence:number}>} trackpoints
 * @param {{duration:number, distance:number, calories:number}} stats
 * @param {string} workoutName
 * @param {string} startTime  ISO-8601 string (e.g. "2024-05-01T09:30:00.000Z")
 * @returns {string} TCX XML
 */
export function generateTCX(trackpoints, stats, workoutName, startTime) {
  const tpXml = trackpoints.map(tp => {
    const parts = [`        <Trackpoint>`, `          <Time>${tp.time}</Time>`];
    if (tp.hr > 0) {
      parts.push(`          <HeartRateBpm><Value>${Math.round(tp.hr)}</Value></HeartRateBpm>`);
    }
    if (tp.cadence > 0) {
      // TCX cadence field is uint8 (max 254)
      parts.push(`          <Cadence>${Math.min(254, Math.round(tp.cadence))}</Cadence>`);
    }
    if (tp.power > 0) {
      parts.push(
        `          <Extensions>`,
        `            <ns3:TPX>`,
        `              <ns3:Watts>${Math.round(tp.power)}</ns3:Watts>`,
        `            </ns3:TPX>`,
        `          </Extensions>`,
      );
    }
    parts.push(`        </Trackpoint>`);
    return parts.join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${stats.duration}</TotalTimeSeconds>
        <DistanceMeters>${Math.round(stats.distance)}</DistanceMeters>
        <Calories>${stats.calories || 0}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${tpXml}
        </Track>
      </Lap>
      <Notes>${escapeXml(workoutName)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

/**
 * Trigger a browser download of a TCX string.
 *
 * @param {string} tcxContent
 * @param {string} filename  e.g. "workout-2024-05-01.tcx"
 */
export function downloadTCX(tcxContent, filename) {
  const blob = new Blob([tcxContent], { type: 'application/vnd.garmin.tcx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
