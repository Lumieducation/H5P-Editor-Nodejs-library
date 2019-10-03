import axios from 'axios';
import axiosMockAdapter from 'axios-mock-adapter';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { withDir } from 'tmp-promise';

import ContentTypeCache from '../src/ContentTypeCache';
import ContentTypeInformationRepository from '../src/ContentTypeInformationRepository';
import EditorConfig from '../src/EditorConfig';
import FileLibraryStorage from '../src/FileLibraryStorage';
import InMemoryStorage from '../src/InMemoryStorage';
import LibraryManager from '../src/LibraryManager';
import TranslationService from '../src/TranslationService';
import User from '../src/User';

const axiosMock = new axiosMockAdapter(axios);

describe('Content type information repository (= connection to H5P Hub)', () => {
    it('gets content types from hub', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/real-content-types.json')
            );

        await cache.updateIfNecessary();

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.outdated).toBe(false);
        expect(content.libraries.length).toEqual(
            require('./data/content-type-cache/real-content-types.json')
                .contentTypes.length
        );
    });
    it("doesn't fail if update wasn't called", async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/real-content-types.json')
            );

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.outdated).toBe(false);
        expect(content.libraries.length).toEqual(
            require('./data/content-type-cache/real-content-types.json')
                .contentTypes.length
        );
    });

    it('adds local libraries', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/0-content-types.json')
            );

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.libraries.length).toEqual(2);
    });

    it('detects updates to local libraries', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/1-content-type.json')
            );

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.libraries.length).toEqual(2);
        expect(content.libraries[0].installed).toEqual(true);
        expect(content.libraries[0].isUpToDate).toEqual(false);
    });

    it('returns local libraries if H5P Hub is unreachable', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock.onPost(config.hubContentTypesEndpoint).reply(500);

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.libraries.length).toEqual(2);
    });

    it('sets LRS dependent content types to restricted', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);
        const user = new User();

        config.enableLrsContentTypes = false;
        config.lrsContentTypes = ['H5P.Example1'];
        user.canCreateRestricted = false;

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock.onPost(config.hubContentTypesEndpoint).reply(500);

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            user,
            new TranslationService({})
        );
        const content = await repository.get();
        expect(content.libraries.length).toEqual(2);
        expect(
            content.libraries.find(l => l.machineName === 'H5P.Example1')
                .restricted
        ).toEqual(true);
        expect(
            content.libraries.find(l => l.machineName === 'H5P.Example3')
                .restricted
        ).toEqual(false);
    });

    it('install rejects invalid machine names', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/real-content-types.json')
            );

        await cache.updateIfNecessary();

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            new User(),
            new TranslationService({
                'hub-install-no-content-type': 'hub-install-no-content-type',
                'hub-install-invalid-content-type':
                    'hub-install-invalid-content-type'
            })
        );
        await expect(repository.install(undefined)).rejects.toThrow(
            'hub-install-no-content-type'
        );
        await expect(repository.install('asd')).rejects.toThrow(
            'hub-install-invalid-content-type'
        );
    });

    it('install rejects unauthorized users', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);
        const libManager = new LibraryManager(
            new FileLibraryStorage(`${path.resolve('')}/test/data/libraries`)
        );
        const cache = new ContentTypeCache(config, storage);
        const user = new User();

        axiosMock
            .onPost(config.hubRegistrationEndpoint)
            .reply(200, require('./data/content-type-cache/registration.json'));
        axiosMock
            .onPost(config.hubContentTypesEndpoint)
            .reply(
                200,
                require('./data/content-type-cache/real-content-types.json')
            );

        await cache.updateIfNecessary();

        const repository = new ContentTypeInformationRepository(
            cache,
            storage,
            libManager,
            config,
            user,
            new TranslationService({
                'hub-install-denied': 'hub-install-denied'
            })
        );

        user.canInstallRecommended = false;
        user.canUpdateAndInstallLibraries = false;
        await expect(repository.install('H5P.Blanks')).rejects.toThrow(
            'hub-install-denied'
        );

        user.canInstallRecommended = true;
        user.canUpdateAndInstallLibraries = false;
        await expect(
            repository.install('H5P.ImageHotspotQuestion')
        ).rejects.toThrow('hub-install-denied');
    });

    it('install content types from the hub', async () => {
        const storage = new InMemoryStorage();
        const config = new EditorConfig(storage);

        await withDir(
            async ({ path: tmpDir }) => {
                const libManager = new LibraryManager(
                    new FileLibraryStorage(tmpDir)
                );
                const cache = new ContentTypeCache(config, storage);
                const user = new User();

                axiosMock
                    .onPost(config.hubRegistrationEndpoint)
                    .reply(
                        200,
                        require('./data/content-type-cache/registration.json')
                    );
                axiosMock
                    .onPost(config.hubContentTypesEndpoint)
                    .reply(
                        200,
                        require('./data/content-type-cache/real-content-types.json')
                    );

                await cache.updateIfNecessary();
                const repository = new ContentTypeInformationRepository(
                    cache,
                    storage,
                    libManager,
                    config,
                    user,
                    new TranslationService({})
                );

                axiosMock.restore(); // TODO: It would be nicer if the download of the Hub File could be mocked as well, but this is not possible as axios-mock-adapter doesn't support stream yet ()
                await expect(
                    repository.install('H5P.DragText')
                ).resolves.toEqual(true);
                const libs = await libManager.getInstalled();
                expect(Object.keys(libs).length).toEqual(11); // TODO: must be adapted to changes in the Hub file
            },
            { keep: false, unsafeCleanup: true }
        );
    }, 30000);
});
