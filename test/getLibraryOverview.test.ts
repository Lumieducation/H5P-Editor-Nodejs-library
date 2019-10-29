import EditorConfig from '../examples/implementation/EditorConfig';

import path from 'path';
import FileLibraryStorage from '../examples/implementation/FileLibraryStorage';
import H5PEditor from '../src/H5PEditor';

describe('getting overview about multiple libraries', () => {
    it('returns basic information about single library', () => {
        return new H5PEditor(
            null,
            new EditorConfig(null),
            new FileLibraryStorage(path.resolve('test/data/libraries')),
            null,
            null,
            (library, name) => '',
            null
        )
            .getLibraryOverview(['H5P.Example1 1.1'])
            .then(libraries =>
                expect(libraries).toEqual([
                    {
                        majorVersion: 1,
                        metadataSettings: null,
                        minorVersion: 1,
                        name: 'H5P.Example1',
                        restricted: false,
                        runnable: 1,
                        title: 'Example 1',
                        tutorialUrl: '',
                        uberName: 'H5P.Example1 1.1'
                    }
                ])
            );
    });

    it('return information about multiple libraries', () => {
        return new H5PEditor(
            null,
            new EditorConfig(null),
            new FileLibraryStorage(path.resolve('test/data/libraries')),
            null,
            null,
            (library, name) => '',
            null
        )
            .getLibraryOverview(['H5P.Example1 1.1', 'H5P.Example3 2.1'])

            .then(libraries => {
                expect(libraries.map(l => l.uberName)).toEqual([
                    'H5P.Example1 1.1',
                    'H5P.Example3 2.1'
                ]);
            });
    });
});
