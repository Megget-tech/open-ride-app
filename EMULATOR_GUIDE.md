# ANT+ Emulator Guide

## What is the Emulator?

The ANT+ emulator simulates both the USB dongle and smart trainers, allowing you to develop and test your training app without needing physical hardware. Perfect for:

- 🚀 Rapid development and iteration
- 🧪 Testing UI components
- 📊 Visualizing telemetry data flow
- 🔧 Debugging control logic
- 💰 Saving trainer battery life

## Quick Start

### Start the Emulator

```bash
cd backend
npm run dev:emulator
```

Or set the environment variable:

```bash
ANT_EMULATOR=true npm run dev
```

### Open the UI

Visit http://localhost:3000

You'll see a purple "🎮 EMULATOR MODE" badge at the top.

## Using the Emulator

### 1. Start Scanning

Click **"Start Scan"** to discover virtual trainers.

The emulator will "discover" 3 devices over a few seconds:
- **Wahoo KICKR CORE** (ID: 12345)
- **Wahoo KICKR** (ID: 54321)
- **Elite Direto** (ID: 99999)

### 2. Connect to a Trainer

Click on any discovered device to connect. You'll see:
- Connection status changes to "Connected"
- Device ID appears
- Telemetry starts streaming (4 updates per second)

### 3. View Telemetry

Watch the real-time data:
- **Power**: Starts at 0W, responds to target power commands
- **Cadence**: Follows power output (0-120 RPM)
- **Speed**: Calculated from power and resistance
- **Heart Rate**: Simulated (correlates with power)
- **Distance**: Accumulates based on speed
- **Elapsed Time**: Counts up

### 4. Control the Trainer

#### Set Target Power (ERG Mode)
1. Enter a wattage (e.g., 150W)
2. Click **"Set Target Power"**
3. Watch the power ramp up to the target over ~7 seconds

#### Set Resistance
1. Enter a percentage (0-100%)
2. Click **"Set Resistance"**
3. Higher resistance = slower speed for same power

## How the Simulation Works

### Realistic Physics

The emulator uses simplified physics to create realistic responses:

**Power Ramping**
- Ramps at 20W/second toward target
- Decays naturally when no target is set

**Cadence**
- Follows power: higher power = higher cadence
- Ranges from 0-120 RPM
- Changes at 5 RPM/second

**Speed**
- Calculated from power and resistance
- Formula: `speed = sqrt(power * resistance_factor) * 2.5`
- Resistance factor: 0.5 to 1.0 based on resistance %

**Heart Rate**
- Base rate: 120 BPM
- Increases with power: `120 + (power / 3)`
- Changes at 2 BPM/second
- Range: 100-190 BPM

**Natural Variation**
- Small random fluctuations added to all values
- Mimics real-world sensor noise

### Update Frequency

- **Telemetry**: 4 Hz (every 250ms)
- Matches typical ANT+ FE-C data rate

## Customizing the Emulator

You can customize the emulator by modifying `backend/src/antManagerEmulator.ts`:

### Add More Devices

```typescript
devices: [
  { deviceId: 12345, name: 'Wahoo KICKR CORE', equipmentType: 'Trainer' },
  { deviceId: 54321, name: 'Wahoo KICKR', equipmentType: 'Trainer' },
  { deviceId: 99999, name: 'Elite Direto', equipmentType: 'Trainer' },
  { deviceId: 11111, name: 'Your Custom Trainer', equipmentType: 'Trainer' },
],
```

### Change Update Rate

```typescript
telemetryInterval: 500, // Update every 500ms (2 Hz) instead of 250ms
```

### Adjust Physics

Modify the `updateRealisticSimulation()` method:

```typescript
const rampRate = 30; // Faster power ramping (W/s)
const targetCadence = state.currentPower > 50 ? 60 + (state.currentPower / 8) : 0; // Different cadence curve
```

## Tips for Development

### Testing Different Scenarios

**High Power Output**
```
Set Target Power: 300W
Watch: Cadence ~100 RPM, Speed ~40 km/h
```

**Steep Hill (High Resistance)**
```
Set Resistance: 80%
Set Target Power: 200W
Watch: Speed drops significantly
```

**Recovery (Low Power)**
```
Set Target Power: 50W
Watch: Smooth ramp down, lower cadence
```

### Debugging Telemetry

Check the **Page Counters** section to verify:
- Page 0x10 (General FE data)
- Page 0x19 (Trainer-specific data)

Both should increment steadily.

## Switching Between Emulator and Real Hardware

### Use Emulator
```bash
npm run dev:emulator
```

### Use Real Hardware
```bash
npm run dev
```

No code changes needed! The app automatically detects the mode via the `ANT_EMULATOR` environment variable.

## Troubleshooting

**Emulator badge not showing?**
- Check browser console for errors
- Verify `/api/status` returns `"emulator": true`

**No telemetry data?**
- Make sure you clicked on a device to connect
- Check connection status is "Connected"
- Look for errors in terminal

**Unrealistic data?**
- Check if `realisticSimulation: true` in emulator config
- Verify telemetry interval isn't too fast/slow

## Next Steps

Now that you have working emulation, you can:

1. **Build training workouts** - Create interval sessions with target power changes
2. **Add visualizations** - Graph power/cadence over time
3. **Implement FTP tests** - Ramp tests, 20-minute tests
4. **Create training zones** - Calculate and display power zones
5. **Save activities** - Log telemetry to files or database

The emulator gives you everything you need to build a complete training app before testing with real hardware!
