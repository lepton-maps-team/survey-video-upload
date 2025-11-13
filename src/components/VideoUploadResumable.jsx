import { useState, useRef } from "react";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const CONCURRENCY = 4;
const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024; // 5GB limit
const EDGE_FUNCTION_URL =
  "https://xengyefjbnoolmqyphxw.supabase.co/functions/v1/test-abd-r2";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhlbmd5ZWZqYm5vb2xtcXlwaHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzOTYzOTEsImV4cCI6MjA1NTk3MjM5MX0.5JFYQNXFe3Jn099q_CByr0t1WogjtXXDFFVAFXr7sgY";
const STORAGE_KEY_BASE = "resumable_uploads_v2";

const VideoUploadResumable = ({ surveyId, onUploadComplete, folder = "" }) => {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const canceledRef = useRef(false);
  const abortControllers = useRef([]);

  const getSurveyStorageKey = (surveyId) =>
    `${STORAGE_KEY_BASE}_${surveyId || "default"}`;
  const getStorageKey = (surveyId, fileName) =>
    `${surveyId || "default"}::${fileName}`;

  const loadSavedUpload = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    return uploads[getStorageKey(surveyId, fileName)];
  };

  const saveUploadProgress = (surveyId, fileName, data, filePath = "") => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    uploads[getStorageKey(surveyId, fileName)] = { ...data, filePath };
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  const clearUploadRecord = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    delete uploads[getStorageKey(surveyId, fileName)];
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  const validateFile = (selectedFile) => {
    if (!selectedFile) {
      return "No file selected";
    }
    if (selectedFile.size === 0) {
      return "File is empty";
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      return `File too large (max ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB)`;
    }
    if (!selectedFile.type.startsWith("video/")) {
      return "File must be a video";
    }
    return null;
  };

  const extractFilePath = (url, fileName) => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      // Remove leading slash and return
      return pathname.startsWith("/") ? pathname.slice(1) : pathname;
    } catch (err) {
      console.error("Failed to parse URL:", err);
      // Fallback to fileName
      return folder ? `${folder}/${fileName}` : fileName;
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    // Reset state
    setError("");
    setUploadProgress(0);
    canceledRef.current = false;

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }

    setFile(selectedFile);

    const saved = loadSavedUpload(surveyId, selectedFile.name);
    if (saved) {
      // Restore meta info to file object
      selectedFile.meta = {
        dateTimestamp: saved.dateTimestamp || new Date().toISOString(),
        fileSizeBytes: saved.fileSizeBytes || selectedFile.size,
      };
      console.log("Previous upload path:", saved.filePath);
    }
  };

  const postEdge = async (bodyObj) => {
    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(bodyObj),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  };

  const getUploadParameters = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder;
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: ts,
    });
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return { url: body.uploadUrl, headers: { "Content-Type": file.type } };
  };

  const createMultipartUpload = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder;
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: ts,
    });
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return { uploadId: body.uploadId, key: body.fileKey };
  };

  const signPart = async (file, { uploadId, partNumber }) => {
    const objectName = folder;
    const fileSizeBytes = file?.meta?.fileSizeBytes || file.size;
    const dateTimestamp = file?.meta?.dateTimestamp || new Date().toISOString();

    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes,
      fileType: file.type,
      dateTimestamp,
      partNumber,
      uploadId,
    });
    return { url: body.uploadUrl };
  };

  const completeMultipartUpload = async (file, uploadData) => {
    const objectName = folder;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: file?.meta?.dateTimestamp || new Date().toISOString(),
      partNumber: totalChunks + 1,
      uploadId: uploadData.uploadId,
      parts: uploadData.parts,
    });
    return { location: body.location };
  };

  const handleCancel = () => {
    canceledRef.current = true;
    abortControllers.current.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch (err) {
        console.error("Error aborting:", err);
      }
    });
    abortControllers.current = [];
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError("");
    canceledRef.current = false;
    abortControllers.current = [];

    try {
      // Single PUT
      if (file.size < MULTIPART_THRESHOLD) {
        const { url, headers } = await getUploadParameters(file);
        const controller = new AbortController();
        abortControllers.current.push(controller);

        const resp = await fetch(url, {
          method: "PUT",
          headers,
          body: file,
          signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`Upload failed: ${resp.statusText}`);

        const filePath = extractFilePath(url, file.name);
        saveUploadProgress(surveyId, file.name, {}, filePath);

        setUploadProgress(100);
        onUploadComplete(surveyId, file.name, filePath);
        clearUploadRecord(surveyId, file.name);

        console.log("✅ Single file upload complete");
        return;
      }

      // Multipart
      let uploadData = loadSavedUpload(surveyId, file.name);
      if (!uploadData || !uploadData.uploadId) {
        uploadData = await createMultipartUpload(file);
        saveUploadProgress(
          surveyId,
          file.name,
          { ...uploadData, parts: [] },
          folder
        );
      }

      const uploadedPartNumbers = new Set(
        (uploadData?.parts ?? []).map((p) => p.PartNumber)
      );
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts = [...(uploadData.parts || [])];

      setUploadProgress(
        Math.round((uploadedPartNumbers.size / totalParts) * 100)
      );

      for (let i = 1; i <= totalParts; i += CONCURRENCY) {
        if (canceledRef.current) {
          throw new Error("Upload canceled by user");
        }

        const batch = [];
        for (let j = i; j < i + CONCURRENCY && j <= totalParts; j++) {
          if (uploadedPartNumbers.has(j)) continue;

          const start = (j - 1) * CHUNK_SIZE;
          const end = Math.min(j * CHUNK_SIZE, file.size);
          const blob = file.slice(start, end);

          batch.push(
            (async () => {
              if (canceledRef.current) {
                throw new Error("Upload canceled");
              }

              const { url } = await signPart(file, {
                uploadId: uploadData.uploadId,
                partNumber: j,
              });

              const controller = new AbortController();
              abortControllers.current.push(controller);

              const resp = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: blob,
                signal: controller.signal,
              });

              if (!resp.ok) throw new Error(`Part ${j} failed`);

              const eTag = resp.headers.get("ETag")?.replaceAll('"', "");
              return { ETag: eTag, PartNumber: j };
            })()
          );
        }

        const results = await Promise.allSettled(batch);

        for (const r of results) {
          if (r.status === "fulfilled") {
            parts.push(r.value);
            uploadedPartNumbers.add(r.value.PartNumber);
            saveUploadProgress(
              surveyId,
              file.name,
              { ...uploadData, parts },
              folder
            );
          } else if (!canceledRef.current) {
            console.error("❌ Chunk upload failed:", r.reason);
            throw r.reason;
          }
        }

        setUploadProgress(Math.round((parts.length / totalParts) * 100));
      }

      if (canceledRef.current) {
        throw new Error("Upload canceled by user");
      }

      // Sort parts by PartNumber before completing
      parts.sort((a, b) => a.PartNumber - b.PartNumber);

      const completed = await completeMultipartUpload(file, {
        uploadId: uploadData.uploadId,
        parts,
      });

      const filePath = extractFilePath(completed.location, file.name);

      onUploadComplete(surveyId, file.name, filePath);
      clearUploadRecord(surveyId, file.name);

      console.log("✅ Multipart upload complete:", completed);
    } catch (err) {
      if (err.name === "AbortError" || canceledRef.current) {
        console.log("🚫 Upload aborted.");
        setError("Upload canceled");
      } else {
        console.error("❌ Upload failed:", err);
        setError(err.message || "Upload failed");
      }
    } finally {
      setUploading(false);
      abortControllers.current = [];
    }
  };

  return (
    <div className=" rounded-md overflow-hidden hover:border-slate-300 transition-colors max-w-40">
      <div className="p-4">
        <label
          className={`block border-2 border-dashed rounded p-4 cursor-pointer transition-all ${
            file
              ? "border-green-500 bg-green-50"
              : "border-slate-300 hover:border-blue-400 bg-slate-50"
          } ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          <div className="text-center">
            {file ? (
              <div>
                <p className="font-semibold text-slate-900 text-sm truncate">
                  {file.name}
                </p>
                <p className="text-xs text-slate-600">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <>
                <p className="font-medium text-slate-700 text-sm">
                  Click or drag video
                </p>
                <p className="text-xs text-slate-500 mt-1">MP4, WebM, MOV</p>
              </>
            )}
          </div>
        </label>
        {error && (
          <p className="text-xs text-red-600 mt-2 font-medium text-center">
            {error}
          </p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap p-4">
        {!uploading && (
          <button
            onClick={handleUpload}
            disabled={!file || uploading || !!error}
            className={`text-sm rounded font-medium w-full p-2 transition-all ${
              !file || uploading || !!error
                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 "
            }`}
          >
            Upload
          </button>
        )}

        {uploading && (
          <button
            onClick={handleCancel}
            className="text-sm rounded font-medium w-full p-2 bg-red-600 hover:bg-red-700 transition-all"
          >
            Cancel Upload
          </button>
        )}
      </div>

      {uploading && file && (
        <div className="border-t border-slate-200 px-4 py-2 bg-slate-50">
          <div className="flex justify-between items-center mb-1">
            <p className="text-xs font-medium text-slate-700">
              {canceledRef.current
                ? "Canceling..."
                : `Uploading: ${uploadProgress}%`}
            </p>
          </div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                canceledRef.current ? "bg-slate-400" : "bg-blue-600"
              }`}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoUploadResumable;
