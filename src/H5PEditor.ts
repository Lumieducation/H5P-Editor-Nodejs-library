import { ReadStream } from 'fs';
import fsExtra from 'fs-extra';
import promisepipe from 'promisepipe';
import stream from 'stream';
import { withFile } from 'tmp-promise';

// tslint:disable-next-line: import-name
import defaultEditorIntegration from '../assets/default_editor_integration.json';
// tslint:disable-next-line: import-name
import defaultTranslation from '../assets/translations/en.json';
// tslint:disable-next-line: import-name
import defaultRenderer from './renderers/default';

import ContentManager from './ContentManager';
import ContentStorer from './ContentStorer';
import ContentTypeCache from './ContentTypeCache';
import ContentTypeInformationRepository from './ContentTypeInformationRepository';
import H5pError from './helpers/H5pError';
import InstalledLibrary from './InstalledLibrary';
import LibraryManager from './LibraryManager';
import LibraryName from './LibraryName';
import PackageImporter from './PackageImporter';
import TemporaryFileManager from './TemporaryFileManager';
import TranslationService from './TranslationService';
import {
    ContentId,
    ContentParameters,
    IAssets,
    IContentMetadata,
    IContentStorage,
    IEditorConfig,
    IEditorIntegration,
    IIntegration,
    IKeyValueStorage,
    ILibraryDetailedDataForClient,
    ILibraryFileUrlResolver,
    ILibraryName,
    ILibraryOverviewForClient,
    ILibraryStorage,
    ISemanticsEntry,
    ITemporaryFileStorage,
    IUser
} from './types';

import Logger from './helpers/Logger';

const log = new Logger('Editor');

export default class H5PEditor {
    constructor(
        keyValueStorage: IKeyValueStorage,
        public config: IEditorConfig,
        libraryStorage: ILibraryStorage,
        contentStorage: IContentStorage,
        translationService: TranslationService,
        /**
         * This function returns the (relative) URL at which a file inside a library
         * can be accessed. It is used when URLs of library files must be inserted
         * (hardcoded) into data structures. The implementation must do this file ->
         * URL resolution, as it decides where the files can be accessed.
         */
        libraryFileUrlResolver: ILibraryFileUrlResolver,
        temporaryStorage: ITemporaryFileStorage
    ) {
        log.info('initialize');
        this.renderer = defaultRenderer;
        this.baseUrl = config.baseUrl;
        this.translation = defaultTranslation;
        this.ajaxPath = config.ajaxPath;
        this.libraryUrl = config.libraryUrl;
        this.filesPath = config.filesPath;
        this.contentTypeCache = new ContentTypeCache(config, keyValueStorage);
        this.libraryManager = new LibraryManager(
            libraryStorage,
            libraryFileUrlResolver
        );
        this.contentManager = new ContentManager(contentStorage);
        this.contentTypeRepository = new ContentTypeInformationRepository(
            this.contentTypeCache,
            keyValueStorage,
            this.libraryManager,
            config,
            translationService
        );
        this.translationService = translationService;
        this.config = config;
        this.packageImporter = new PackageImporter(
            this.libraryManager,
            this.translationService,
            this.config,
            this.contentManager
        );
        this.temporaryFileManager = new TemporaryFileManager(
            temporaryStorage,
            this.config
        );
        this.contentStorer = new ContentStorer(
            this.contentManager,
            this.libraryManager,
            this.temporaryFileManager
        );
    }

    public contentTypeCache: ContentTypeCache;
    public libraryManager: LibraryManager;
    public temporaryFileManager: TemporaryFileManager;

    private ajaxPath: string;
    private baseUrl: string;
    private contentManager: ContentManager;
    private contentStorer: ContentStorer;
    private contentTypeRepository: ContentTypeInformationRepository;
    private filesPath: string;
    private libraryUrl: string;
    private packageImporter: PackageImporter;
    private renderer: any;
    private translation: any;
    private translationService: TranslationService;

    /**
     * Returns a stream for a file that was uploaded for a content object.
     * The requested content file can be a temporary file uploaded for unsaved content or a
     * file in permanent content storage.
     * @param contentId the content id (undefined if retrieved for unsaved content)
     * @param filename the file to get (without 'content/' prefix!)
     * @param user the user who wants to retrieve the file
     * @returns a stream of the content file
     */
    public async getContentFileStream(
        contentId: ContentId,
        filename: string,
        user: IUser
    ): Promise<ReadStream> {
        // We have to try the regular content repository first and then fall back to the temporary storage.
        // This is necessary as the H5P client ignores the '#tmp' suffix we've added to temporary files.
        try {
            // we don't directly return the result of the getters as try - catch would not work then
            const returnStream = await this.contentManager.getContentFileStream(
                contentId,
                `content/${filename}`,
                user
            );
            return returnStream;
        } catch (error) {
            log.debug(
                `Couldn't find file ${filename} in storage. Trying temporary storage.`
            );
        }
        return this.temporaryFileManager.getFileStream(filename, user);
    }

    public getContentTypeCache(user: IUser): Promise<any> {
        log.info(`getting content type cache`);
        return this.contentTypeRepository.get(user);
    }

    public getLibraryData(
        machineName: string,
        majorVersion: number,
        minorVersion: number,
        language: string = 'en'
    ): Promise<ILibraryDetailedDataForClient> {
        log.info(
            `getting data for library ${machineName}-${majorVersion}.${minorVersion}`
        );
        const library = new LibraryName(
            machineName,
            majorVersion,
            minorVersion
        );
        return Promise.all([
            this.loadAssets(machineName, majorVersion, minorVersion, language),
            this.libraryManager.loadSemantics(library),
            this.libraryManager.loadLanguage(library, language),
            this.libraryManager.listLanguages(library),
            this.libraryManager.getUpgradesScriptPath(library)
        ]).then(
            ([
                assets,
                semantics,
                languageObject,
                languages,
                upgradeScriptPath
            ]) => ({
                languages,
                semantics,
                // tslint:disable-next-line: object-literal-sort-keys
                css: assets.styles,
                defaultLanguage: null,
                language: languageObject,
                name: machineName,
                version: {
                    major: majorVersion,
                    minor: minorVersion
                },
                javascript: assets.scripts,
                translations: assets.translations,
                upgradesScript: upgradeScriptPath // we don't check whether the path is null, as we can retur null
            })
        );
    }

    /**
     * Retrieves the installed languages for libraries
     * @param libraryNames A list of libraries for which the language files should be retrieved.
     *                     In this list the names of the libraries don't use hyphens to separate
     *                     machine name and version.
     * @param language the language code to get the files for
     * @returns The strings of the language files
     */
    public async getLibraryLanguageFiles(
        libraryNames: string[],
        language: string
    ): Promise<{ [key: string]: string }> {
        log.info(
            `getting language files (${language}) for ${libraryNames.join(
                ', '
            )}`
        );
        return (
            await Promise.all(
                libraryNames.map(async name => {
                    const lib = LibraryName.fromUberName(name, {
                        useWhitespace: true
                    });
                    return {
                        languageJson: await this.libraryManager.loadLanguage(
                            lib,
                            language
                        ),
                        name
                    };
                })
            )
        ).reduce((builtObject: any, { languageJson, name }) => {
            if (languageJson) {
                builtObject[name] = JSON.stringify(languageJson);
            }
            return builtObject;
        }, {});
    }

    public async getLibraryOverview(
        libraryNames: string[]
    ): Promise<ILibraryOverviewForClient[]> {
        log.info(
            `getting library overview for libraries: ${libraryNames.join(', ')}`
        );
        return (
            await Promise.all(
                libraryNames
                    .map(name =>
                        LibraryName.fromUberName(name, {
                            useWhitespace: true
                        })
                    )
                    .filter(lib => lib !== undefined) // we filter out undefined values as Library.creatFromNames returns undefined for invalid names
                    .map(async lib => {
                        const loadedLibrary = await this.libraryManager.loadLibrary(
                            lib
                        );
                        if (!loadedLibrary) {
                            return undefined;
                        }
                        return {
                            majorVersion: loadedLibrary.majorVersion,
                            metadataSettings: null,
                            minorVersion: loadedLibrary.minorVersion,
                            name: loadedLibrary.machineName,
                            restricted: false,
                            runnable: loadedLibrary.runnable,
                            title: loadedLibrary.title,
                            tutorialUrl: '',
                            uberName: `${loadedLibrary.machineName} ${loadedLibrary.majorVersion}.${loadedLibrary.minorVersion}`
                        };
                    })
            )
        ).filter(lib => lib !== undefined); // we filter out undefined values as the last map return undefined values if a library doesn't exist
    }

    /**
     * Installs a content type from the H5P Hub.
     * @param {string} id The name of the content type to install (e.g. H5P.Test-1.0)
     * @returns {Promise<true>} true if successful. Will throw errors if something goes wrong.
     */
    public async installLibrary(id: string, user: IUser): Promise<boolean> {
        return this.contentTypeRepository.install(id, user);
    }

    public async loadH5P(
        contentId: ContentId,
        user?: IUser
    ): Promise<{
        h5p: IContentMetadata;
        library: string;
        params: {
            metadata: IContentMetadata;
            params: ContentParameters;
        };
    }> {
        log.info(`loading h5p for ${contentId}`);
        const [h5pJson, content] = await Promise.all([
            this.contentManager.loadH5PJson(contentId, user),
            this.contentManager.loadContent(contentId, user)
        ]);
        return {
            h5p: h5pJson,
            library: this.getUbernameFromH5pJson(h5pJson),
            params: {
                metadata: h5pJson,
                params: content
            }
        };
    }

    public render(contentId: ContentId): Promise<string> {
        log.info(`rendering ${contentId}`);
        const model = {
            integration: this.integration(contentId),
            scripts: this.coreScripts(),
            styles: this.coreStyles()
        };

        return Promise.resolve(this.renderer(model));
    }

    /**
     * Stores an uploaded file in temporary storage.
     * @param contentId the id of the piece of content the file is attached to; Set to null/undefined if
     * the content hasn't been saved before.
     * @param field the semantic structure of the field the file is attached to.
     * @param file information about the uploaded file
     */
    public async saveContentFile(
        contentId: ContentId,
        field: ISemanticsEntry,
        file: {
            data: Buffer;
            mimetype: string;
            name: string;
            size: number;
        },
        user: IUser
    ): Promise<{ mime: string; path: string }> {
        const dataStream: any = new stream.PassThrough();
        dataStream.end(file.data);

        log.info(`Putting content file ${file.name} into temporary storage`);
        const tmpFilename = await this.temporaryFileManager.saveFile(
            file.name,
            dataStream,
            user
        );
        log.debug(`New temporary filename is ${tmpFilename}`);
        return {
            mime: file.mimetype,
            path: `${tmpFilename}#tmp`
        };
    }

    /**
     * Stores new content or updates existing content.
     * Copies over files from temporary storage if necessary.
     * @param contentId the contentId of existing content (undefined or previously unsaved content)
     * @param parameters the content parameters (=content.json)
     * @param metadata the content metadata (~h5p.json)
     * @param mainLibraryName the ubername with whitespace as separator (no hyphen!)
     * @param user the user who wants to save the piece of content
     * @returns the existing contentId or the newly assigned one
     */
    public async saveH5P(
        contentId: ContentId,
        parameters: ContentParameters,
        metadata: IContentMetadata,
        mainLibraryName: string,
        user: IUser
    ): Promise<ContentId> {
        if (contentId !== undefined) {
            log.info(`saving h5p content for ${contentId}`);
        } else {
            log.info('saving new content');
        }

        const h5pJson: IContentMetadata = await this.generateH5PJSON(
            metadata,
            mainLibraryName,
            this.findLibraries(parameters)
        );

        const newContentId = await this.contentStorer.saveOrUpdateContent(
            contentId,
            parameters,
            h5pJson,
            mainLibraryName,
            user
        );
        return newContentId;
    }

    public setAjaxPath(ajaxPath: string): H5PEditor {
        log.info(`setting ajax path to ${ajaxPath}`);
        this.ajaxPath = ajaxPath;
        return this;
    }

    /**
     * Adds the contents of a package to the system.
     * @param {*} data The data (format?)
     * @param {number} contentId (optional) the content id of the uploaded package
     * @returns {Promise<string>} the newly created content it or the one passed to it
     */
    public async uploadPackage(
        data: Buffer,
        contentId: ContentId,
        user: IUser
    ): Promise<ContentId> {
        log.info(`uploading package for ${contentId}`);
        const dataStream: any = new stream.PassThrough();
        dataStream.end(data);

        let newContentId: ContentId;

        await withFile(
            async ({ path: tempPackagePath }) => {
                const writeStream = fsExtra.createWriteStream(tempPackagePath);
                try {
                    await promisepipe(dataStream, writeStream);
                } catch (error) {
                    throw new H5pError(
                        this.translationService.getTranslation(
                            'upload-package-failed-tmp'
                        )
                    );
                }

                newContentId = await this.packageImporter.addPackageLibrariesAndContent(
                    tempPackagePath,
                    user,
                    contentId
                );
            },
            { postfix: '.h5p', keep: false }
        );

        return newContentId;
    }

    public useRenderer(renderer: any): H5PEditor {
        this.renderer = renderer;
        return this;
    }

    private coreScripts(): string[] {
        return [
            '/core/js/jquery.js',
            '/core/js/h5p.js',
            '/core/js/h5p-event-dispatcher.js',
            '/core/js/h5p-x-api-event.js',
            '/core/js/h5p-x-api.js',
            '/core/js/h5p-content-type.js',
            '/core/js/h5p-confirmation-dialog.js',
            '/core/js/h5p-action-bar.js',
            '/editor/scripts/h5p-hub-client.js',
            '/editor/scripts/h5peditor-editor.js',
            '/editor/scripts/h5peditor.js',
            '/editor/scripts/h5peditor-semantic-structure.js',
            '/editor/scripts/h5peditor-library-selector.js',
            '/editor/scripts/h5peditor-form.js',
            '/editor/scripts/h5peditor-text.js',
            '/editor/scripts/h5peditor-html.js',
            '/editor/scripts/h5peditor-number.js',
            '/editor/scripts/h5peditor-textarea.js',
            '/editor/scripts/h5peditor-file-uploader.js',
            '/editor/scripts/h5peditor-file.js',
            '/editor/scripts/h5peditor-image.js',
            '/editor/scripts/h5peditor-image-popup.js',
            '/editor/scripts/h5peditor-av.js',
            '/editor/scripts/h5peditor-group.js',
            '/editor/scripts/h5peditor-boolean.js',
            '/editor/scripts/h5peditor-list.js',
            '/editor/scripts/h5peditor-list-editor.js',
            '/editor/scripts/h5peditor-library.js',
            '/editor/scripts/h5peditor-library-list-cache.js',
            '/editor/scripts/h5peditor-select.js',
            '/editor/scripts/h5peditor-selector-hub.js',
            '/editor/scripts/h5peditor-selector-legacy.js',
            '/editor/scripts/h5peditor-dimensions.js',
            '/editor/scripts/h5peditor-coordinates.js',
            '/editor/scripts/h5peditor-none.js',
            '/editor/scripts/h5peditor-metadata.js',
            '/editor/scripts/h5peditor-metadata-author-widget.js',
            '/editor/scripts/h5peditor-metadata-changelog-widget.js',
            '/editor/scripts/h5peditor-pre-save.js',
            '/editor/ckeditor/ckeditor.js'
        ].map((file: string) => `${this.baseUrl}${file}`);
    }

    private coreStyles(): string[] {
        return [
            '/core/styles/h5p.css',
            '/core/styles/h5p-confirmation-dialog.css',
            '/core/styles/h5p-core-button.css',
            '/editor/libs/darkroom.css',
            '/editor/styles/css/h5p-hub-client.css',
            '/editor/styles/css/fonts.css',
            '/editor/styles/css/application.css',
            '/editor/styles/css/libs/zebra_datepicker.min.css'
        ].map((file: string) => `${this.baseUrl}${file}`);
    }

    private editorIntegration(contentId: ContentId): IEditorIntegration {
        log.info(`generating integration for ${contentId}`);
        return {
            ...defaultEditorIntegration,
            ajaxPath: this.ajaxPath,
            apiVersion: {
                majorVersion: this.config.coreApiVersion.major,
                minorVersion: this.config.coreApiVersion.minor
            },
            assets: {
                css: [
                    '/core/styles/h5p.css',
                    '/core/styles/h5p-confirmation-dialog.css',
                    '/core/styles/h5p-core-button.css',
                    '/editor/libs/darkroom.css',
                    '/editor/styles/css/h5p-hub-client.css',
                    '/editor/styles/css/fonts.css',
                    '/editor/styles/css/application.css',
                    '/editor/styles/css/libs/zebra_datepicker.min.css'
                ].map((asset: string) => `${this.baseUrl}${asset}`),
                js: [
                    '/core/js/jquery.js',
                    '/core/js/h5p.js',
                    '/core/js/h5p-event-dispatcher.js',
                    '/core/js/h5p-x-api-event.js',
                    '/core/js/h5p-x-api.js',
                    '/core/js/h5p-content-type.js',
                    '/core/js/h5p-confirmation-dialog.js',
                    '/core/js/h5p-action-bar.js',
                    '/editor/scripts/h5p-hub-client.js',
                    '/editor/scripts/h5peditor.js',
                    '/editor/language/en.js',
                    '/editor/scripts/h5peditor-semantic-structure.js',
                    '/editor/scripts/h5peditor-library-selector.js',
                    '/editor/scripts/h5peditor-form.js',
                    '/editor/scripts/h5peditor-text.js',
                    '/editor/scripts/h5peditor-html.js',
                    '/editor/scripts/h5peditor-number.js',
                    '/editor/scripts/h5peditor-textarea.js',
                    '/editor/scripts/h5peditor-file-uploader.js',
                    '/editor/scripts/h5peditor-file.js',
                    '/editor/scripts/h5peditor-image.js',
                    '/editor/scripts/h5peditor-image-popup.js',
                    '/editor/scripts/h5peditor-av.js',
                    '/editor/scripts/h5peditor-group.js',
                    '/editor/scripts/h5peditor-boolean.js',
                    '/editor/scripts/h5peditor-list.js',
                    '/editor/scripts/h5peditor-list-editor.js',
                    '/editor/scripts/h5peditor-library.js',
                    '/editor/scripts/h5peditor-library-list-cache.js',
                    '/editor/scripts/h5peditor-select.js',
                    '/editor/scripts/h5peditor-selector-hub.js',
                    '/editor/scripts/h5peditor-selector-legacy.js',
                    '/editor/scripts/h5peditor-dimensions.js',
                    '/editor/scripts/h5peditor-coordinates.js',
                    '/editor/scripts/h5peditor-none.js',
                    '/editor/scripts/h5peditor-metadata.js',
                    '/editor/scripts/h5peditor-metadata-author-widget.js',
                    '/editor/scripts/h5peditor-metadata-changelog-widget.js',
                    '/editor/scripts/h5peditor-pre-save.js',
                    '/editor/ckeditor/ckeditor.js'
                ].map((asset: string) => `${this.baseUrl}${asset}`)
            },
            filesPath: contentId
                ? `${this.filesPath}/${contentId}/content`
                : this.config.temporaryFilesPath,
            libraryUrl: this.libraryUrl
        };
    }

    private findLibraries(object: any, collect: any = {}): ILibraryName[] {
        if (typeof object !== 'object') return collect;

        Object.keys(object).forEach((key: string) => {
            if (key === 'library' && object[key].match(/.+ \d+\.\d+/)) {
                const [name, version] = object[key].split(' ');
                const [major, minor] = version.split('.');

                collect[object[key]] = {
                    machineName: name,
                    majorVersion: parseInt(major, 10),
                    minorVersion: parseInt(minor, 10)
                };
            } else {
                this.findLibraries(object[key], collect);
            }
        });

        return Object.values(collect);
    }

    private generateH5PJSON(
        metadata: IContentMetadata,
        libraryName: string,
        contentDependencies: ILibraryName[] = []
    ): Promise<IContentMetadata> {
        log.info(`generating h5p.json`);
        return new Promise((resolve: (value: IContentMetadata) => void) => {
            this.libraryManager
                .loadLibrary(
                    LibraryName.fromUberName(libraryName, {
                        useWhitespace: true
                    })
                )
                .then((library: InstalledLibrary) => {
                    const h5pJson: IContentMetadata = {
                        ...metadata,
                        mainLibrary: library.machineName,
                        preloadedDependencies: [
                            ...contentDependencies,
                            ...(library.preloadedDependencies || []), // empty array should preloadedDependencies be undefined
                            {
                                machineName: library.machineName,
                                majorVersion: library.majorVersion,
                                minorVersion: library.minorVersion
                            }
                        ]
                    };
                    resolve(h5pJson);
                });
        });
    }

    private getUbernameFromH5pJson(h5pJson: IContentMetadata): string {
        const library = (h5pJson.preloadedDependencies || []).find(
            dependency => dependency.machineName === h5pJson.mainLibrary
        );
        if (!library) {
            return '';
        }
        return LibraryName.toUberName(library, { useWhitespace: true });
    }

    private integration(contentId: ContentId): IIntegration {
        return {
            ajax: {
                contentUserData: '',
                setFinished: ''
            },
            ajaxPath: this.ajaxPath,
            editor: this.editorIntegration(contentId),
            hubIsEnabled: true,
            l10n: {
                H5P: this.translation
            },
            postUserStatistics: false,
            saveFreq: false,
            url: this.baseUrl,
            user: {
                mail: '',
                name: ''
            }
        };
    }

    private loadAssets(
        machineName: string,
        majorVersion: number,
        minorVersion: number,
        language: string,
        loaded: object = {}
    ): Promise<IAssets> {
        const key: string = `${machineName}-${majorVersion}.${minorVersion}`;
        const path: string = `${this.baseUrl}/libraries/${key}`;

        if (key in loaded) return Promise.resolve(null);
        loaded[key] = true;

        const assets: IAssets = {
            scripts: [],
            styles: [],
            translations: {}
        };

        const lib: LibraryName = new LibraryName(
            machineName,
            majorVersion,
            minorVersion
        );

        return Promise.all([
            this.libraryManager.loadLibrary(lib),
            this.libraryManager.loadLanguage(lib, language || 'en')
        ])
            .then(([library, translation]) =>
                Promise.all([
                    this.resolveDependencies(
                        library.preloadedDependencies || [],
                        language,
                        loaded
                    ),
                    this.resolveDependencies(
                        library.editorDependencies || [],
                        language,
                        loaded
                    )
                ]).then(combinedDependencies => {
                    combinedDependencies.forEach(dependencies =>
                        dependencies.forEach(dependency => {
                            dependency.scripts.forEach(script =>
                                assets.scripts.push(script)
                            );
                            dependency.styles.forEach(script =>
                                assets.styles.push(script)
                            );
                            Object.keys(dependency.translations).forEach(k => {
                                assets.translations[k] =
                                    dependency.translations[k];
                            });
                        })
                    );

                    (library.preloadedJs || []).forEach(script =>
                        assets.scripts.push(`${path}/${script.path}`)
                    );
                    (library.preloadedCss || []).forEach(style =>
                        assets.styles.push(`${path}/${style.path}`)
                    );
                    assets.translations[machineName] = translation || undefined;
                })
            )

            .then(() => assets);
    }

    private resolveDependencies(
        originalDependencies: ILibraryName[],
        language: string,
        loaded: object
    ): Promise<IAssets[]> {
        const dependencies: ILibraryName[] = originalDependencies.slice();
        const resolved: IAssets[] = [];

        const resolve: (dependency: ILibraryName) => Promise<any> = (
            dependency: ILibraryName
        ) => {
            if (!dependency) return Promise.resolve(resolved);

            return this.loadAssets(
                dependency.machineName,
                dependency.majorVersion,
                dependency.minorVersion,
                language,
                loaded
            )
                .then((assets: IAssets) =>
                    assets ? resolved.push(assets) : null
                )
                .then(() => resolve(dependencies.shift()));
        };

        return resolve(dependencies.shift());
    }
}
