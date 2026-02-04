import React, { useEffect, useState } from "react";
import axios from "axios";

interface CsvRow {
  id: number,
  post_id: number,
  csv_id: number,
  name: string,
  email: string,
  body: string
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<CsvRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false); // For the table refresh
  const [uploadProgress, setUploadProgress] = useState(0); // State for the loading percentage
  const [backendMessage, setBackendMessage] = useState("");
  const [jumpPage, setJumpPage] = useState("");
  const [filters, setFilters] = useState({
    name: "",
    email: "",
    body: "",
    post_id: "",
    csv_id: ""
  });
  const limit = 5;
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

  // Fetch data from backend
  const fetchData = async () => {
    setIsLoadingData(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/data`, {
        params: { page, limit,
          ...filters // Spreads name, email, etc. into the request
        },
      });
      setData(res.data.data);
      setTotal(res.data.total);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, filters]);

  // Handle CSV upload
  const handleUpload = async () => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload a .csv file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("File too large (max 10MB).");
      return;
    }
    if (file.size === 0) {
      alert("File is empty.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setBackendMessage("Uploading file to server...");

    const eventSource = new EventSource(`${API_BASE_URL}/upload-progress`);

    eventSource.onmessage = (event) => {
      let status: any;
      try {
        status = JSON.parse(event.data);
      } catch {
        alert("JSON unable to parse data");
        return;
      }
      if (status.total > 0) {
        const backendPercent = Math.round((status.current / status.total) * 100);
        const combinedPercent = 50 + Math.round(backendPercent / 2);

        setUploadProgress(combinedPercent);
        setBackendMessage(status.message);
      }
      if (status.message === "Finished") {
        alert("File processed and saved successfully!");
        setUploadProgress(100); // Force to 100%
        setBackendMessage("File Upload Complete");
        eventSource.close();
        setFile(null);
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        
        setPage(1);
        fetchData();  

        setIsUploading(false);
        setBackendMessage("");
        setUploadProgress(0);
      }
    };

    const formData = new FormData();
    formData.append("file", file);

    try {
      await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const uploadPercent = Math.round((progressEvent.loaded / progressEvent.total * 100));
            setUploadProgress(Math.round(uploadPercent / 2));
          }
        },
      });
    } catch (error) {
      eventSource.close();
      console.error("Upload failed", error);
      setIsUploading(false);
      alert("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearData = async () => {
    if (!window.confirm("Are you sure you want to delete ALL data? This cannot be undone.")) {
      return;
    }

    try {
      setIsLoadingData(true);
      await axios.delete(`${API_BASE_URL}/data`);
      
      // Reset state locally
      setData([]);
      setTotal(0);
      setPage(1);
      
      alert("Database cleared!");
    } catch (err) {
      console.error(err);
      alert("Failed to clear data.");
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleJumpPage = () => {
    const pageNum = parseInt(jumpPage);
    if (pageNum > 0 && pageNum <= totalPages) {
      setPage(pageNum);
      setJumpPage(""); // Clear the input after jumping
    } else {
      alert(`Please enter a valid page between 1 and ${totalPages}`);
    }
  };

  const handleFilterChange = (column: string, value: string) => {
    setFilters(prev => ({ ...prev, [column]: value }));
    setPage(1); // Reset to page 1 when filtering
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ padding: "20px" }}>
      <h2>CSV Upload & Data Table</h2>

      {/* Upload Section */}
      <div style={{ marginBottom: "20px", border: "1px solid #ccc", padding: "10px" }}>
        <input
          type="file"
          accept=".csv"
          disabled={isUploading}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />

        <button data-testid="upload-btn" onClick={handleUpload} disabled={!file || isUploading}>
          {isUploading ? "Uploading & Processing..." : "Upload CSV"}
        </button>

        {isUploading && (
          <div style={{ marginTop: "10px", width: "100%", maxWidth: "400px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
              <span style={{ fontWeight: "bold" }}>{backendMessage}</span>
              <span>{uploadProgress}%</span>
            </div>
            
            <div style={{ 
              height: "12px", 
              width: "100%", 
              backgroundColor: "#e0e0df", 
              borderRadius: "6px",
              overflow: "hidden" 
            }}>
              <div style={{ 
                height: "100%", 
                width: `${uploadProgress}%`, 
                backgroundColor: uploadProgress === 100 ? "#28a745" : "#4caf50", 
                transition: "width 0.3s ease-out"
              }} />
            </div>
          </div>
        )}
      </div>

      <button 
        onClick={handleClearData} 
        style={{ 
          backgroundColor: "#ff4d4d", 
          color: "white", 
          marginLeft: "10px",
          border: "none",
          padding: "5px 10px",
          cursor: "pointer",
          borderRadius: "4px"
        }}
        disabled={isUploading || isLoadingData}
      >
        Clear All Data
      </button>

      {/* Data Table */}
      <table border={1} style={{ marginTop: "10px", width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#f2f2f2" }}>
            <th>post_id</th>
            <th>csv_id</th>
            <th>name</th>
            <th>email</th>
            <th>body</th>
          </tr>
          <tr>
            {/* Search Inputs for each column */}
            <th>
              <input style={{width: '80%'}} placeholder="ID..." value={filters.post_id} onChange={(e) => handleFilterChange("post_id", e.target.value)} />
            </th>
            <th>
              <input style={{width: '80%'}} placeholder="ID..." value={filters.csv_id} onChange={(e) => handleFilterChange("csv_id", e.target.value)} />
            </th>
            <th>
              <input style={{width: '80%'}} placeholder="Name..." value={filters.name} onChange={(e) => handleFilterChange("name", e.target.value)} />
            </th>
            <th>
              <input style={{width: '80%'}} placeholder="Email..." value={filters.email} onChange={(e) => handleFilterChange("email", e.target.value)} />
            </th>
            <th>
              <input style={{width: '80%'}} placeholder="Content..." value={filters.body} onChange={(e) => handleFilterChange("body", e.target.value)} />
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td>{row.post_id}</td>
              <td>{row.csv_id}</td>
              <td>{row.name}</td>
              <td>{row.email}</td>
              <td>{row.body}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
        <button 
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page === 1 || isLoadingData}
        >
          Previous
        </button>
        <span data-testid = "page-text"style={{ fontWeight: "bold" }}>
          Page {page} of {totalPages}
        </span>
        <button
          data-testid="next-btn"
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          disabled={page === totalPages || isLoadingData}
        >
          Next
        </button>
        <div style={{ marginLeft: "20px", display: "flex", alignItems: "center", gap: "5px" }}>
          <label htmlFor="jump">Go to page:</label>
          <input
            id="jump"
            type="number"
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJumpPage()} // Jump on Enter key
            style={{ width: "50px", padding: "3px" }}
            placeholder="No."
          />
          <button onClick={handleJumpPage} disabled={isLoadingData}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
