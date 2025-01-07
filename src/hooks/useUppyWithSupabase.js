import { useState, useEffect } from 'react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
/**
 * Custom hook for configuring Uppy with Supabase authentication and TUS resumable uploads
 * @param {Object} options - Configuration options for the Uppy instance
 * @param {string} options.bucketName - The bucket name in Supabase where files are stored
 * @param {string} options.folder - Optional folder path within the bucket
 * @param {Object} options.restrictions - Optional upload restrictions
 * @returns {Object} uppy - Uppy instance with configured upload settings
 */
export const useUppyWithSupabase = ({ 
  bucketName, 
  folder = '', 
  restrictions = {} 
}) => {
  const [uppy] = useState(() => {
    const instance = new Uppy({
      id: `uppy-${bucketName}-${folder}`,
      autoProceed: true,
      allowMultipleUploadBatches: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: ['video/*'],
        ...restrictions
      }
    }).use(Tus, {
      endpoint: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: import.meta.env.VITE_SUPABASE_ANON_KEY
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      allowedMetaFields: [
        'bucketName',
        'objectName',
        'contentType',
        'cacheControl',
      ]
    })

    return instance
  })

  // Handle file metadata
  useEffect(() => {
    const handleFileAdded = (file) => {
      const objectName = folder ? `${folder}/${file.name}` : file.name
      file.meta = {
        ...file.meta,
        bucketName,
        objectName,
        contentType: file.type,
      }
    }

    uppy.on('file-added', handleFileAdded)
    return () => {
      uppy.off('file-added', handleFileAdded)
    }
  }, [uppy, bucketName, folder])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      uppy.cancelAll()
    }
  }, [uppy])

  return uppy
} 