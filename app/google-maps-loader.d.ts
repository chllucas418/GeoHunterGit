// Type declaration shim for @googlemaps/js-api-loader
// The package bundles its own types but some IDE/TS configurations
// fail to resolve them through the exports map.
declare module '@googlemaps/js-api-loader' {
    export function setOptions(options: { key: string; v?: string; libraries?: string[] }): void;
    export function importLibrary(name: string): Promise<any>;

    /** @deprecated Use setOptions() and importLibrary() instead */
    export class Loader {
        constructor(options: any);
        load(): Promise<typeof google>;
        importLibrary(name: string): Promise<any>;
    }
}
