import { startWindowSensor } from './desktopPet/windows/sensor';

const port = process.parentPort;
if (!port) throw new Error('Window sensor requires an isolated Electron utility process');
startWindowSensor(port, () => process.exit(0));
