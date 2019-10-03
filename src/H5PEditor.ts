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
import ContentTypeCache from './ContentTypeCache';
// tslint:disable-next-line: import-name
import ContentTypeInformationRepository from './ContentTypeInformationRepository';
import H5pError from './helpers/H5pError';
import Library from './Library';
import LibraryManager from './LibraryManager';
import PackageImporter from './PackageImporter';
import TranslationService from './TranslationService';

import EditorConfig from './EditorConfig';

import {
    Content,
    ContentId,
    IAssets,
    IContentStorage,
    IDependency,
    IEditorIntegration,
    IH5PJson,
    IIntegration,
    IKeyValueStorage,
    ILibraryData,
    ILibraryInfo,
    ILibraryStorage,
    IMetadata,
    IURLConfig,
    IUser
} from './types';

export default class H5PEditor {
    constructor(
        urls: IURLConfig = {
            ajaxPath: '/ajax?action=',
            baseUrl: '/h5p',
            filesPath: '',
            libraryUrl: '/h5p/editor/'
        },
        keyValueStorage: IKeyValueStorage,
        config: EditorConfig,
        libraryStorage: ILibraryStorage,
        contentStorage: IContentStorage,
        user: IUser,
        translationService: TranslationService
    ) {
        this.renderer = defaultRenderer;
        this.baseUrl = urls.baseUrl;
        this.translation = defaultTranslation;
        this.ajaxPath = urls.ajaxPath;
        this.libraryUrl = urls.libraryUrl;
        this.filesPath = urls.filesPath;
        this.contentTypeCache = new ContentTypeCache(config, keyValueStorage);
        this.libraryManager = new LibraryManager(libraryStorage);
        this.contentManager = new ContentManager(contentStorage);
        this.contentTypeRepository = new ContentTypeInformationRepository(
            this.contentTypeCache,
            keyValueStorage,
            this.libraryManager,
            config,
            user,
            translationService
        );
        this.translationService = translationService;
        this.config = config;
        this.user = user;
        this.packageImporter = new PackageImporter(
            this.libraryManager,
            this.translationService,
            this.config,
            this.contentManager
        );
    }

    public libraryManager: LibraryManager;

    private ajaxPath: string;
    private baseUrl: string;
    private config: EditorConfig;
    private contentManager: ContentManager;
    private contentTypeCache: ContentTypeCache;
    private contentTypeRepository: ContentTypeInformationRepository;
    private filesPath: string;
    private libraryUrl: string;
    private packageImporter: PackageImporter;
    private renderer: any;
    private translation: any;
    private translationService: TranslationService;
    private user: any;

    public getContentTypeCache(): Promise<any> {
        return this.contentTypeRepository.get();
    }

    public getLibraryData(
        machineName: string,
        majorVersion: number,
        minorVersion: number,
        language: string = 'en'
    ): Promise<ILibraryData> {
        const library: Library = new Library(
            machineName,
            majorVersion,
            minorVersion
        );
        return Promise.all([
            this.loadAssets(machineName, majorVersion, minorVersion, language),
            this.libraryManager.loadSemantics(library),
            this.libraryManager.loadLanguage(library, language),
            this.libraryManager.listLanguages(library)
        ]).then(([assets, semantics, languageObject, languages]) => ({
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
            translations: assets.translations
        }));
    }

    public getLibraryOverview(libraryNames: string[]): Promise<ILibraryInfo[]> {
        return Promise.all(
            libraryNames.map((libraryName: string) => {
                const {
                    machineName,
                    majorVersion,
                    minorVersion
                } = this.parseLibraryString(libraryName);
                const lib: Library = new Library(
                    machineName,
                    majorVersion,
                    minorVersion
                );
                return this.libraryManager
                    .loadLibrary(lib)
                    .then((library: Library) => {
                        return {
                            majorVersion: library.majorVersion,
                            metadataSettings: null,
                            minorVersion: library.minorVersion,
                            name: library.machineName,
                            restricted: false,
                            runnable: library.runnable,
                            title: library.title,
                            tutorialUrl: '',
                            uberName: `${library.machineName} ${library.majorVersion}.${library.minorVersion}`
                        };
                    });
            })
        );
    }

    /**
     * Installs a content type from the H5P Hub.
     * @param {string} id The name of the content type to install (e.g. H5P.Test-1.0)
     * @returns {Promise<true>} true if successful. Will throw errors if something goes wrong.
     */
    public async installLibrary(id: string): Promise<boolean> {
        return this.contentTypeRepository.install(id);
    }

    public loadH5P(
        contentId: ContentId,
        user?: IUser
    ): Promise<{
        h5p: IH5PJson;
        library: string;
        params: {
            metadata: IH5PJson;
            params: Content;
        };
    }> {
        return Promise.all([
            this.contentManager.loadH5PJson(contentId, user),
            this.contentManager.loadContent(contentId, user)
        ]).then(([h5pJson, content]) => ({
            h5p: h5pJson,
            library: this.getUbernameFromH5pJson(h5pJson),
            params: {
                metadata: h5pJson,
                params: content
            }
        }));
    }

    public render(contentId: ContentId): Promise<string> {
        const model = {
            integration: this.integration(contentId),
            scripts: this.coreScripts(),
            styles: this.coreStyles()
        };

        return Promise.resolve(this.renderer(model));
    }

    public saveContentFile(
        contentId: ContentId,
        field: any,
        file: any
    ): Promise<{ mime: string; path: string }> {
        const dataStream: any = new stream.PassThrough();
        dataStream.end(file.data);

        return this.contentManager
            .addContentFile(contentId, file.name, dataStream, undefined)
            .then(() => ({
                mime: file.mimetype,
                path: file.name
            }));
    }

    public async saveH5P(
        contentId: ContentId,
        content: Content,
        metadata: IMetadata,
        libraryName: string
    ): Promise<ContentId> {
        const h5pJson: IH5PJson = await this.generateH5PJSON(
            metadata,
            libraryName,
            this.findLibraries(content)
        );
        return this.contentManager.createContent(
            h5pJson,
            content,
            undefined,
            contentId
        );
    }

    public setAjaxPath(ajaxPath: string): H5PEditor {
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
        contentId: ContentId
    ): Promise<ContentId> {
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
                    this.user,
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
            '/editor/ckeditor/ckeditor.js',
            '/editor/wp/h5p-editor.js'
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
        return {
            ...defaultEditorIntegration,
            ajaxPath: this.ajaxPath,
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
            filesPath: `${this.filesPath}/${contentId}/content`,
            libraryUrl: this.libraryUrl
        };
    }

    private findLibraries(object: any, collect: any = {}): IDependency[] {
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
        metadata: IMetadata,
        libraryName: string,
        contentDependencies: IDependency[] = []
    ): Promise<IH5PJson> {
        return new Promise((resolve: (value: IH5PJson) => void) => {
            this.libraryManager
                .loadLibrary(
                    Library.createFromName(libraryName.replace(' ', '-'))
                )
                .then((library: Library) => {
                    const h5pJson: IH5PJson = {
                        language: '',
                        license: '',
                        ...metadata,
                        mainLibrary: library.machineName,
                        preloadedDependencies: [
                            ...contentDependencies,
                            ...library.preloadedDependencies,
                            {
                                machineName: library.machineName,
                                majorVersion: library.majorVersion,
                                minorVersion: library.minorVersion
                            }
                        ],
                        title: ''
                    };
                    resolve(h5pJson);
                });
        });
    }

    private getUbernameFromH5pJson(h5pJson: IH5PJson): string {
        const library: IDependency = (
            h5pJson.preloadedDependencies || []
        ).filter(
            (dependency: IDependency) =>
                dependency.machineName === h5pJson.mainLibrary
        )[0];
        return `${library.machineName} ${library.majorVersion}.${library.minorVersion}`;
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

        const lib: Library = new Library(
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

    private parseLibraryString(libraryName: string): IDependency {
        return {
            machineName: libraryName.split(' ')[0],
            majorVersion: parseInt(libraryName.split(' ')[1].split('.')[0], 10),
            minorVersion: parseInt(libraryName.split(' ')[1].split('.')[1], 10)
        };
    }

    private resolveDependencies(
        originalDependencies: IDependency[],
        language: string,
        loaded: object
    ): Promise<IAssets[]> {
        const dependencies: IDependency[] = originalDependencies.slice();
        const resolved: IAssets[] = [];

        const resolve: (dependency: IDependency) => Promise<any> = (
            dependency: IDependency
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
