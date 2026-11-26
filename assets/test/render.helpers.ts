import { jest } from '@jest/globals';

// Holds the next componentOnReady of the stand-in element (see jest.setup.ts) until the returned function is called.
export const holdRender = (tag: string) => {
  let release: () => void = () => {};
  const proto = customElements.get(tag)!.prototype as { componentOnReady: () => Promise<unknown> };
  jest.spyOn(proto, 'componentOnReady').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve(undefined);
      }),
  );

  return () => release();
};
