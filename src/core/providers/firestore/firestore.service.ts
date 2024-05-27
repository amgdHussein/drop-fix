import { Logger } from '@nestjs/common';

import {
  CollectionReference,
  DocumentData,
  FieldValue,
  Firestore,
  FirestoreDataConverter,
  PartialWithFieldValue,
  Query,
  QueryDocumentSnapshot,
  WhereFilterOp,
  WithFieldValue,
} from '@google-cloud/firestore';

import { BadRequestException, InternalServerErrorException, NotFoundException } from '../../exceptions';
import { Utils } from '../../utils';

import { QueryOp, QueryOrder, QueryParam, SearchResult } from '../../shared';

export class FirestoreService<T extends { id: string }> {
  private readonly logger = new Logger(FirestoreService.name);

  private readonly collection = this.firestore.collection(this.collectionProvider) as CollectionReference<T & { id: string }, DocumentData>;

  private readonly collectionName: string = this.collectionProvider.slice(0, -1);

  private readonly filterOpToFirestoreOp: { [key in QueryOp]: WhereFilterOp } = {
    eq: '==',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    in: 'in',
    nin: 'not-in',
    arcoay: 'array-contains-any',
    arco: 'array-contains',
  };

  private readonly firestoreConverter: FirestoreDataConverter<T> = {
    /**
     * Drop id and undefined fields if exists
     * @param {WithFieldValue<T>} entity Entity to set/ update
     * @return {T} The data provided to firestore
     */
    toFirestore(entity: WithFieldValue<T>): PartialWithFieldValue<T> {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...data } = entity;
      return Utils.Object.dropUndefined(data);
    },

    /**
     * Converts a Firestore document snapshot to a custom type.
     * @param {QueryDocumentSnapshot<T>} snapshot - The Firestore document snapshot to convert
     * @return {T & { id: string }} The converted custom type
     */
    fromFirestore(snapshot: QueryDocumentSnapshot<T>): T & { id: string } {
      const data = snapshot.data();
      return { ...data, id: snapshot.id };
    },
  };

  constructor(
    private readonly firestore: Firestore,
    private readonly collectionProvider: string,
  ) {}

  /**
   * Retrieves a document with the specified id from the collection.
   * @param {string} id - The id of the document to retrieve
   * @return {Promise<T>} The retrieved document
   */
  public async getDoc(id: string): Promise<T> {
    const docRef = this.collection.doc(id).withConverter<T>(this.firestoreConverter);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException(`The ${this.collectionName} with specified id(${id}) does not exist!`);
    }

    return doc.data();
  }

  /**
   * A description of the entire function.
   * @return {Promise<T[]>} description of return value
   */
  public async getDocs(): Promise<T[]> {
    const query = this.collection.withConverter<T>(this.firestoreConverter);
    return await query
      .get()
      .then(snapshot => snapshot.docs.map(doc => doc.data()))
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException('Something went wrong while fetching the documents!');
      });
  }

  /**
   * Adds a new document to the collection.
   * @param {T} entity - the entity to be added
   * @return {Promise<T>} a promise that resolves with the added entity
   */
  public async addDoc(entity: Partial<T>): Promise<T> {
    const docRef = this.collection.doc().withConverter<Partial<T>>(this.firestoreConverter);

    return await docRef
      .set(entity)
      .then(() => ({ ...entity, id: docRef.id }) as T)
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while adding new ${this.collectionName} document!`);
      });
  }

  /**
   * Add a new document to specified CollectionReference with the given data, assigning it a document ID automatically.
   * @param {T} entity Document data to be added (Id not required)
   * @return {Promise<T>} The new document data
   */
  public async setDoc(entity: T): Promise<T> {
    const docRef = this.collection.doc(entity.id).withConverter<T>(this.firestoreConverter);

    return await docRef
      .set(entity)
      .then(() => entity)
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while replacing ${this.collectionName} document!`);
      });
  }

  /**
   * Adds multiple documents to the specified CollectionReference with the given data, assigning them document IDs automatically.
   *
   * @param {Partial<T>[]} entities - Array of document data to be added (Id not required)
   * @return {Promise<T[]>} Promise that resolves to an array of the new document data
   * @throws {InternalServerErrorException} If an error occurs while adding the documents
   */
  public async setDocs(entities: Partial<T>[]): Promise<T[]> {
    const docRef = this.collection.doc().withConverter<T>(this.firestoreConverter);
    const batch = docRef.firestore.batch();

    const addedDocs = entities.map(entity => {
      batch.set(docRef, entity as T);
      return { id: docRef.id, ...entity };
    });

    return await batch
      .commit()
      .then(() => addedDocs as T[])
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while adding multiple ${this.collectionName}.`);
      });
  }

  /**
   * Updates fields in the document referred to by the specified DocumentReference.
   * The update will fail if applied to a document that does not exist.
   * @param {T} entity Document data to be updated (Id must be specified)
   * @return {Promise<T>} The updated document data
   */
  public async updateDoc(entity: Partial<T> & { id: string }): Promise<T> {
    const flatEntity = Utils.Object.flat(entity);

    const docRef = this.collection.doc(entity.id).withConverter<T>(this.firestoreConverter);
    return await docRef
      .update(flatEntity)
      .then(async () => await this.getDoc(docRef.id))
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while updating ${this.collectionName} document!`);
      });
  }

  /**
   * Updates multiple documents in the Firestore collection.
   *
   * @param {(Partial<T> & { id: string })[]} entities - An array of partial entities with their IDs.
   * @return {Promise<T[]>} A promise that resolves to true if the update is successful, or rejects with an error.
   */
  public async updateDocs(entities: (Partial<T> & { id: string })[]): Promise<T[]> {
    const batch = this.collection.firestore.batch();

    entities.map(entity => {
      const docRef = this.collection.doc(entity.id).withConverter<T>(this.firestoreConverter);
      const flatEntity = Utils.Object.flat(entity);
      batch.update(docRef, flatEntity);
    });

    return await batch
      .commit()
      .then(() => entities as T[])
      .catch(error => {
        Logger.error(error);
        throw new InternalServerErrorException(`An error occurred while adding multiple ${this.collectionName}.`);
      });
  }

  /**
   * Deletes the document referred to by the specified DocumentReference.
   * @param {string} id The ID of the document to be deleted
   * @return {Promise<T>} The deleted document data
   */
  public async deleteDoc(id: string): Promise<T> {
    const entity = await this.getDoc(id); // Throw error if the id not exist

    const docRef = this.collection.doc(id);
    return await docRef
      .delete()
      .then(() => entity)
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while deleting ${this.collectionName} document!`);
      });
  }

  /**
   * Executes the query and returns the results as a QuerySnapshot.
   * @param {number} page Pagination to prevent data overload
   * @param {number} limit Number of entities per page
   * @param {Array<QueryParam>} filters - List of QueryParam each filter has its own {field, operator, value}
   * @param {QueryOrder} orderBy - Order object that contains {field, direction} to sort by field in specified direction
   * @return {Promise<SearchResult<T>>} The query documents data and meta data
   */
  public async query(page: number = 1, limit: number = 30, params?: QueryParam[], orderBy?: QueryOrder): Promise<SearchResult<T>> {
    let queries: Query<T> = this.buildQuery(params).withConverter<T>(this.firestoreConverter);
    const entities: number = (await queries.count().get()).data().count;

    if (orderBy) queries = queries.orderBy(orderBy.key, orderBy.dir);
    if (page > 0 && limit > 0) queries = queries.offset(limit * (page - 1));
    if (limit > 0) queries = queries.limit(limit);

    const data: T[] = await queries
      .get()
      .then(snapshot => snapshot.docs.map(doc => doc.data()))
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException('An error occurred while querying data!');
      });

    return {
      output: data, // items
      page: page, // current page
      pages: Math.ceil(entities / limit), // number of pages
      perPage: limit, // number of items per page
      total: entities, // total number of items exists
    };
  }

  /**
   * Create queries by applying filters
   * @param {Array<QueryParam>} filters List of filters to be applied
   * @return {Query<T>} Query object that meets filters
   */
  private buildQuery(params?: QueryParam[]): Query<T> {
    let query: Query<T> = this.collection;

    if (params && params.length > 0) {
      for (const queryParam of params) {
        query = query.where(queryParam.key, this.filterOpToFirestoreOp[queryParam.operator], queryParam.value);
      }
    }

    return query;
  }

  /**
   * Increment a specific field of a document by a certain value.
   * @param {string} id - The ID of the document to be updated
   * @param {string} field - The name of the field to be incremented
   * @param {number} incrementValue - The value by which the field should be incremented
   * @return {Promise<T>} A promise that resolves to the updated document
   */
  public async incrementField(id: string, field: string, incrementValue: number): Promise<T> {
    const docRef = this.collection.doc(id);

    const entity: T = await this.getDoc(id); // Throw error if the id not exist

    if (!entity[field]) {
      throw new BadRequestException(`Field ${field} does not exist!`);
    }

    if (incrementValue <= 0) {
      throw new BadRequestException('Increment value must be greater than 0!');
    }

    return await docRef
      .update(field, FieldValue.increment(incrementValue))
      .then(() => {
        return { ...entity, [field]: entity[field] + incrementValue };
      })
      .catch(error => {
        this.logger.error(error);
        throw new InternalServerErrorException(`An error occurred while incrementing ${field}!`);
      });
  }
}
