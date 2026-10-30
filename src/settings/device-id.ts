/** The first characters of a device id: enough to tell two devices with the same name apart. */
export const shortDeviceId = (id: string): string => id.slice(0, 8);
